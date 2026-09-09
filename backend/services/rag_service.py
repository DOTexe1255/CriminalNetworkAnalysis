"""Evidence-first RAG for Trace case questions and case summaries."""

from __future__ import annotations

import ast
import os
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_huggingface import ChatHuggingFace, HuggingFaceEndpoint
from neo4j import GraphDatabase

from .vector_store import VectorStore


class RagService:
    def __init__(self, vector_store: VectorStore) -> None:
        self.vector_store = vector_store
        self.model_id = os.getenv("HF_MODEL", "deepseek-ai/DeepSeek-V4-Flash-0731")
        self._llm: ChatHuggingFace | None = None
        self._neo4j_driver = None

    def _get_llm(self) -> ChatHuggingFace:
        if self._llm is None:
            token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")
            if not token:
                raise RuntimeError("HF_TOKEN is required for case question answering")
            endpoint = HuggingFaceEndpoint(
                repo_id=self.model_id,
                huggingfacehub_api_token=token,
                task="conversational",
                max_new_tokens=900,
                temperature=0.05,
            )
            self._llm = ChatHuggingFace(llm=endpoint)
        return self._llm

    def _get_neo4j(self):
        if self._neo4j_driver is None:
            uri = os.getenv("NEO4J_URI")
            user = os.getenv("NEO4J_USERNAME")
            password = os.getenv("NEO4J_PASSWORD")
            if not all((uri, user, password)):
                return None
            self._neo4j_driver = GraphDatabase.driver(uri, auth=(user, password))
        return self._neo4j_driver

    @staticmethod
    def _person_names(driver, person_ids: list[str]) -> dict[str, str]:
        if not driver or not person_ids:
            return {}
        with driver.session() as session:
            rows = session.run(
                """
                UNWIND $ids AS id
                OPTIONAL MATCH (p:Person {id: id})
                RETURN id, coalesce(p.full_name, id) AS name
                """,
                ids=person_ids,
            )
            return {row["id"]: row["name"] for row in rows}

    def _enrich_sources(self, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Replace raw person IDs in source descriptions with investigator-readable names."""
        driver = self._get_neo4j()
        if not driver:
            return sources

        person_ids: set[str] = set()
        for item in sources:
            metadata = item.get("metadata") or {}
            raw = metadata.get("entity_ids", "")
            if isinstance(raw, str):
                person_ids.update(x for x in raw.split("|") if x)

        names = self._person_names(driver, sorted(person_ids))
        enriched: list[dict[str, Any]] = []

        for item in sources:
            copy = dict(item)
            metadata = dict(copy.get("metadata") or {})
            entity_ids = metadata.get("entity_ids", "")
            ids = entity_ids.split("|") if isinstance(entity_ids, str) else []
            entity_names = [names.get(pid, pid) for pid in ids if pid]
            copy["entity_names"] = list(dict.fromkeys(entity_names))

            description = str(copy.get("content") or "")
            for pid, name in names.items():
                description = description.replace(pid, name)
            copy["content"] = description

            source_record_id = metadata.get("source_record_id")
            copy["source_record_id"] = source_record_id
            copy["evidence_type"] = metadata.get("evidence_type") or copy.get("source_type")
            enriched.append(copy)

        return enriched

    def _case_graph_context(self, case_id: str) -> str:
        """Fetch small, factual graph context so the model can explain relationships."""
        driver = self._get_neo4j()
        if not driver:
            return ""

        query = """
        MATCH (c:Case {id: $case_id})
        OPTIONAL MATCH (c)-[:ASSOCIATED_WITH]->(p:Person)
        WITH c, collect(DISTINCT p) AS people
        OPTIONAL MATCH (c)-[:HAS_FINDING]->(f:Finding)
        WITH c, people,
             collect(DISTINCT CASE WHEN f IS NULL THEN NULL ELSE {
                 type: f.finding_type,
                 title: f.title,
                 importance: f.importance,
                 description: f.description
             } END) AS findings
        RETURN c.title AS title,
               c.case_number AS case_number,
               c.case_type AS case_type,
               c.agency AS agency,
               c.status AS status,
               size(people) AS people_count,
               [p IN people | coalesce(p.full_name, p.id)][0..30] AS people_names,
               [x IN findings WHERE x IS NOT NULL][0..12] AS findings
        """
        with driver.session() as session:
            record = session.run(query, case_id=case_id).single()

        if not record:
            return ""

        lines = [
            f"Case: {record['title']} ({record['case_number']})",
            f"Type: {record['case_type'] or 'not recorded'}; Agency: {record['agency'] or 'not recorded'}; Status: {record['status'] or 'not recorded'}.",
            f"Associated people recorded in the graph: {record['people_count']}.",
        ]
        names = record["people_names"] or []
        if names:
            lines.append("Named people in the case graph: " + ", ".join(names) + ".")

        findings = record["findings"] or []
        if findings:
            lines.append("Analytical observations already stored in the graph:")
            for finding in findings:
                lines.append(
                    f"- {finding['type']}: {finding['title']} ({finding['importance']}). "
                    f"{finding['description']}"
                )
        return "\n".join(lines)

    @staticmethod
    def _format_sources(sources: list[dict[str, Any]]) -> str:
        blocks = []
        for index, item in enumerate(sources, start=1):
            date = item.get("event_date") or "undated"
            evidence_type = item.get("evidence_type") or item.get("source_type") or "Record"
            names = item.get("entity_names") or []
            entities = f"; people: {', '.join(names)}" if names else ""
            record_id = item.get("source_record_id")
            record = f"; source record: {record_id}" if record_id else ""
            blocks.append(
                f"[{index}] {evidence_type} | date: {date}{entities}{record}\n"
                f"Fact: {item.get('content', '')}"
            )
        return "\n\n".join(blocks)

    @staticmethod
    def _clean_response(response: Any) -> str:
        answer = getattr(response, "content", response)
        if isinstance(answer, list):
            answer = "\n".join(
                str(item.get("text", item)) if isinstance(item, dict) else str(item)
                for item in answer
            )
        text = str(answer).strip()
        if not text:
            raw = str(response)
            if "content=" in raw:
                encoded = raw.split("content=", 1)[1].split(" additional_kwargs=", 1)[0].strip()
                try:
                    text = str(ast.literal_eval(encoded)).strip()
                except (SyntaxError, ValueError):
                    text = encoded.strip("'")
        return text

    def _invoke(self, system: str, human: str, values: dict[str, Any]) -> str:
        prompt = ChatPromptTemplate.from_messages([
            ("system", system),
            ("human", human),
        ])
        return self._clean_response((prompt | self._get_llm()).invoke(values))

    def summarize_case(self, case_id: str) -> dict[str, Any]:
        # Summary retrieval deliberately uses a balanced evidence mix rather than
        # ordinary semantic top-k, otherwise a generic summary query tends to
        # return five records of the same type (often calls only).
        sources = self.vector_store.case_summary_search(case_id, limit=12)
        sources = self._enrich_sources(sources)
        graph_context = self._case_graph_context(case_id)

        if not sources and not graph_context:
            return {
                "answer": "No indexed case material is available for this case yet.",
                "sources": [],
                "case_id": case_id,
            }

        context = self._format_sources(sources)
        system = """
You are Trace, an evidence-grounded investigation research assistant.
Your job is to organize recorded facts for an investigator, not to decide guilt.

STRICT RULES:
- Use ONLY the supplied case graph context and numbered evidence records.
- Never invent names, dates, amounts, relationships, motives, or events.
- Do not infer criminality, guilt, intent, or causation from contact alone.
- Every factual statement about a supplied record must cite its source as [n].
- If the graph contains an analytical finding, describe it as an analytical observation, not as proof.
- Distinguish what is recorded from what remains unknown.
- Do not expose internal person IDs when a person's name is supplied.
- Keep the answer concise and investigator-friendly.

Use exactly these sections:
## Recorded facts
## Key relationships
## Notable activity
## Open questions
## Evidence limits

If a section is not supported by the supplied material, write "Not established by the supplied records."
"""
        human = """
Case ID: {case_id}

CASE GRAPH CONTEXT:
{graph_context}

NUMBERED EVIDENCE RECORDS:
{context}

Prepare the case summary now. Cite the numbered records inline, for example [1] or [3][7].
"""
        answer = self._invoke(system, human, {
            "case_id": case_id,
            "graph_context": graph_context or "No graph context available.",
            "context": context or "No evidence records available.",
        })

        if not answer:
            answer = "The supplied records could not be summarized."
        return {
            "answer": answer,
            "sources": sources,
            "case_id": case_id,
            "model": self.model_id,
        }

    def answer(self, case_id: str, question: str) -> dict[str, Any]:
        sources = self.vector_store.similarity_search(case_id, question, limit=8)
        sources = self._enrich_sources(sources)
        graph_context = self._case_graph_context(case_id)

        if not sources and not graph_context:
            return {
                "answer": "No indexed case material is available for this case yet.",
                "sources": [],
                "case_id": case_id,
            }

        context = self._format_sources(sources)
        system = """
You are Trace, an evidence-grounded investigation research assistant.
Answer the investigator's question using ONLY the supplied graph context and evidence records.

Rules:
- Never invent facts or fill gaps with outside knowledge.
- Every factual claim from an evidence record must cite [n].
- Do not claim guilt, innocence, motive, intent, or criminality.
- A relationship or contact is not proof of wrongdoing.
- Use people's names when available; never expose internal IDs when names are supplied.
- If the records do not answer the question, say so explicitly.
- Prefer a short direct answer followed by supporting facts and open questions.
"""
        human = """
Case ID: {case_id}
Question: {question}

CASE GRAPH CONTEXT:
{graph_context}

NUMBERED EVIDENCE RECORDS:
{context}

Answer the question. Cite the supporting records inline as [1], [2], etc.
"""
        answer = self._invoke(system, human, {
            "case_id": case_id,
            "question": question,
            "graph_context": graph_context or "No graph context available.",
            "context": context or "No matching evidence records available.",
        })
        if not answer:
            answer = (
                f"The case has {len(sources)} retrieved records, but the available material "
                "does not support a reliable generated answer."
            )
        return {
            "answer": answer,
            "sources": sources,
            "case_id": case_id,
            "model": self.model_id,
        }

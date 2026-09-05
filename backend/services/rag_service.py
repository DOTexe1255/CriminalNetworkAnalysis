"""Case-scoped retrieval-augmented generation using LangChain and Hugging Face."""

from __future__ import annotations

import os
import ast
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_huggingface import ChatHuggingFace, HuggingFaceEndpoint

from .vector_store import VectorStore


class RagService:
    def __init__(self, vector_store: VectorStore) -> None:
        self.vector_store = vector_store
        self.model_id = os.getenv("HF_MODEL", "deepseek-ai/DeepSeek-V4-Flash-0731")
        self._llm: ChatHuggingFace | None = None

    def _get_llm(self) -> ChatHuggingFace:
        if self._llm is None:
            token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")
            if not token:
                raise RuntimeError("HF_TOKEN is required for case question answering")
            endpoint = HuggingFaceEndpoint(
                repo_id=self.model_id,
                huggingfacehub_api_token=token,
                task="conversational",
                max_new_tokens=700,
                temperature=0.1,
            )
            self._llm = ChatHuggingFace(llm=endpoint)
        return self._llm

    def answer(self, case_id: str, question: str) -> dict[str, Any]:
        sources = self.vector_store.similarity_search(case_id, question)
        if not sources:
            return {
                "answer": "No indexed case material is available for this case yet.",
                "sources": [],
                "case_id": case_id,
            }
        context = "\n\n".join(
            f"[{index + 1}] {item['title']} ({item['event_date'] or 'undated'}): {item['content']}"
            for index, item in enumerate(sources)
        )
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are a careful criminal-investigation research assistant. Answer only from the supplied case context. Separate facts from inference, never claim guilt, and cite source numbers like [1]."),
            ("human", "Case ID: {case_id}\nQuestion: {question}\n\nCase context:\n{context}"),
        ])
        response = (prompt | self._get_llm()).invoke({
            "case_id": case_id, "question": question, "context": context,
        })
        answer = getattr(response, "content", response)
        if isinstance(answer, list):
            answer = "\n".join(str(item.get("text", item)) if isinstance(item, dict) else str(item) for item in answer)
        if not str(answer).strip():
            raw_response = str(response)
            if "content=" in raw_response:
                encoded_content = raw_response.split("content=", 1)[1].split(" additional_kwargs=", 1)[0].strip()
                try:
                    answer = ast.literal_eval(encoded_content)
                except (SyntaxError, ValueError):
                    answer = encoded_content.strip("'")
        if not str(answer).strip():
            answer = (
                f"Case {case_id} has {len(sources)} retrieved records. "
                + " ".join(
                    f"{item['event_date'] or 'Undated'}: {item['content']}"
                    for item in sources[:3]
                )
                + " This is an evidence summary for investigator review, not a conclusion of guilt."
            )
        return {
            "answer": str(answer),
            "sources": sources,
            "case_id": case_id,
            "model": self.model_id,
        }

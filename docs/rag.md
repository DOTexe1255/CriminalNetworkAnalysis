# RAG and Vector Search

1. A case note, evidence description, or uploaded PDF is converted to text.
2. The text is stored in PostgreSQL with its case ID and optional event date.
3. A 384-dimensional embedding is generated. By default this is a deterministic local fallback so containers can seed without downloading a local transformer model. Set `USE_HF_EMBEDDINGS=true` to use the configured Hugging Face embedding endpoint.
4. A user question is embedded and matched only against documents for the requested case.
5. The retrieved passages are passed to LangChain and `deepseek-ai/DeepSeek-V4-Flash-0731` through Hugging Face.
6. The answer is returned with source titles and dates.

The prompt instructs the model to use supplied context only, distinguish facts from inference, cite source numbers, and avoid guilt conclusions. The RAG layer is an investigation aid, not an automated decision system.

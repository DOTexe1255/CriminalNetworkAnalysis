export type RagSource = {
  title: string;
  event_date?: string | null;
  source_type?: string | null;
  evidence_type?: string | null;
  source_record_id?: string | null;
};

export type RagAnalyticalContext = {
  id?: string | null;
  finding_type?: string | null;
  title?: string | null;
  importance?: string | null;
  description?: string | null;
};

type RagAttributionProps = {
  sources: RagSource[];
  analyticalContext?: RagAnalyticalContext[];
};

function humanize(value?: string | null) {
  if (!value) return "Record";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function RagAttribution({
  sources,
  analyticalContext = [],
}: RagAttributionProps) {
  const uniqueSources = sources.filter(
    (source, index, all) =>
      index ===
      all.findIndex(
        (other) =>
          (other.source_record_id || other.title) ===
            (source.source_record_id || source.title) &&
          (other.event_date || "") === (source.event_date || ""),
      ),
  );

  const uniqueFindings = analyticalContext.filter(
    (finding, index, all) =>
      index ===
      all.findIndex(
        (other) =>
          (other.id || other.title) === (finding.id || finding.title),
      ),
  );

  if (!uniqueSources.length && !uniqueFindings.length) return null;

  return (
    <div className="rag-attribution">
      {uniqueSources.length > 0 && (
        <div className="rag-attribution-group">
          <span className="rag-attribution-label">EVIDENCE SOURCES</span>
          <div className="rag-source-list">
            {uniqueSources.map((source, index) => (
              <span
                className="rag-source-chip"
                key={`${source.source_record_id || source.title}-${source.event_date || index}`}
              >
                <b>{humanize(source.evidence_type || source.source_type || source.title)}</b>
                {source.event_date && <small>{source.event_date}</small>}
                {source.source_record_id && (
                  <small>{source.source_record_id}</small>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {uniqueFindings.length > 0 && (
        <div className="rag-attribution-group">
          <span className="rag-attribution-label">ANALYTICAL CONTEXT</span>
          <div className="rag-analysis-list">
            {uniqueFindings.map((finding, index) => (
              <span
                className="rag-analysis-chip"
                key={finding.id || `${finding.title}-${index}`}
                title={finding.description || finding.title || ""}
              >
                <b>{humanize(finding.finding_type || finding.title)}</b>
                {finding.title &&
                  finding.title !== finding.finding_type && (
                    <small>{finding.title}</small>
                  )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

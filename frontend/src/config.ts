const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;

// API calls already include /api in their paths. In Docker, Nginx owns that
// prefix, so the frontend base URL must be empty rather than /api.
export const API_BASE_URL =
	configuredApiBaseUrl === "/api" ? "" : configuredApiBaseUrl || "http://localhost:8000";

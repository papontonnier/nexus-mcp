import type { DependencyAnalysis, ProjectCatalog, ProjectInspection, ProjectStructure } from "@nexus/developer-toolkit/types";
import { request } from "../../services/http";

const projectUrl = (id: string) => "/api/developer/projects/" + encodeURIComponent(id);
export type StructureQuery = { path?: string; depth?: number; q?: string; ext?: string; limit?: number };

export const developerApi = {
  projects: () => request<ProjectCatalog>("/api/developer/projects"),
  inspect: (id: string) => request<ProjectInspection>(projectUrl(id) + "/inspect"),
  dependencies: (id: string) => request<DependencyAnalysis>(projectUrl(id) + "/dependencies"),
  structure: (id: string, query: StructureQuery) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    return request<ProjectStructure>(projectUrl(id) + "/structure?" + params);
  }
};

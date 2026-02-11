export type SearchResult = {
  agentId: string;
  fileName: string;
  matchLine: string;
  lineNumber: number;
  snippet: string;
};

export type SearchResponse = {
  results: SearchResult[];
  query: string;
  totalMatches: number;
};

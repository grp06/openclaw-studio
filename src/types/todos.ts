export interface TodoItem {
  text: string;
  project?: string;
  completed: boolean;
  source: 'captures';
}

export interface TodosData {
  items: TodoItem[];
  lastUpdated: string;
}

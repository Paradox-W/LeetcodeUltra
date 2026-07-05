export interface GridCell {
  content: string;
  tag?: string;
  color?: string;
}

export interface GridRow {
  label?: string;
  columns: GridCell[];
}

export interface GridMarker {
  id?: string;
  row: number;
  column: number;
  rows?: number;
  columns?: number;
  label?: string;
  color?: string;
}

export interface GridVisualizationData {
  kind: { grid: true };
  rows: GridRow[];
  markers?: GridMarker[];
  warnings?: string[];
}

export interface TextVisualizationData {
  kind: { text: true };
  text: string;
  warnings?: string[];
}

export interface ErrorVisualizationData {
  kind: { error: true };
  text: string;
  warnings?: string[];
}

export type VisualizationData = GridVisualizationData | TextVisualizationData | ErrorVisualizationData;

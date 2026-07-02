/** View-model types for the Cloud graph projection (M-Cloud TC.1).
 *
 * These are pure data shapes with no dependency on storage, React, or DOM.
 * The graph is a read-only projection of canonical data (INV-10 / brief §15.2):
 * it never defines relationships, it only reflects notes/tags/links/tasks
 * that already exist in the repositories.
 */

export interface GraphNodeVM {
  id: string;
  title: string;
  /** Sorted dominant-first: the tag with the most notes overall comes
   * first; ties broken lexicographically. */
  tags: string[];
  /** Count of tasks with status='open' that have a task_ref in this note. */
  openTaskCount: number;
  /** Number of edges (wiki or suggested) touching this node. */
  degree: number;
}

export type GraphEdgeKind = 'wiki' | 'suggested';

export interface GraphEdgeVM {
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

export interface GraphVM {
  nodes: GraphNodeVM[];
  edges: GraphEdgeVM[];
}

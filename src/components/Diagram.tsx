import type { ReactNode } from "react";
import type { Diagram, DiagramNode } from "../../shared/guide";

// Diagrams drawn from structured facts in the guide: no generated imagery, so
// every label comes from the material and the drawing matches the app's type
// and colors in both themes. Layouts respond to the width they're given.

const KIND_LABEL: Record<Diagram["kind"], string> = {
  process: "Process",
  cycle: "Cycle",
  spectrum: "Scale",
  comparison: "Comparison",
  hierarchy: "Structure",
};

export function DiagramView({ d }: { d: Diagram }) {
  return (
    <figure className={`diagram diagram-${d.kind}`} aria-label={`${KIND_LABEL[d.kind]}: ${d.title}`}>
      <header className="diagram-head">
        <span className="label">{KIND_LABEL[d.kind]}</span>
        <h3 className="diagram-title">{d.title}</h3>
      </header>
      <div className="diagram-body">
        {d.kind === "process" && <Flow nodes={d.nodes} />}
        {d.kind === "cycle" && <Flow nodes={d.nodes} cycle />}
        {d.kind === "spectrum" && <Spectrum nodes={d.nodes} low={d.low_label} high={d.high_label} />}
        {d.kind === "comparison" && <Comparison columns={d.columns} rows={d.rows} />}
        {d.kind === "hierarchy" && <Tree nodes={d.nodes} />}
      </div>
      {d.caption && <figcaption>{d.caption}</figcaption>}
    </figure>
  );
}

function Flow({ nodes, cycle = false }: { nodes: DiagramNode[]; cycle?: boolean }) {
  return (
    <div className={`flow ${nodes.length <= 5 ? "flow-fits" : ""}`} style={{ ["--cols" as string]: nodes.length }}>
      <ol className="flow-steps">
        {nodes.map((n, i) => (
          <li key={i} className="flow-step">
            <span className="flow-num mono" aria-hidden>
              {i + 1}
            </span>
            <span className="flow-text">
              <span className="flow-label">{n.label}</span>
              {n.detail && <span className="flow-detail">{n.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {cycle && (
        <div className="flow-return" role="note">
          <span className="flow-return-rail" aria-hidden />
          <span className="flow-return-text">
            Repeats: back to <span className="mono">1</span> {nodes[0]?.label}
          </span>
        </div>
      )}
    </div>
  );
}

function Spectrum({ nodes, low, high }: { nodes: DiagramNode[]; low: string; high: string }) {
  return (
    <div className="spectrum" style={{ ["--n" as string]: nodes.length }}>
      <div className="spectrum-ends" aria-hidden>
        <span>{low}</span>
        <span>{high}</span>
      </div>
      <div className="spectrum-bar" aria-hidden />
      <ol className="spectrum-items" aria-label={low && high ? `From ${low} to ${high}` : undefined}>
        {nodes.map((n, i) => (
          <li key={i}>
            <span className="spectrum-tick" aria-hidden />
            <span className="flow-label">{n.label}</span>
            {n.detail && <span className="flow-detail">{n.detail}</span>}
          </li>
        ))}
      </ol>
      {high && (
        <div className="spectrum-foot" aria-hidden>
          {high}
        </div>
      )}
    </div>
  );
}

function Comparison({ columns, rows }: { columns: string[]; rows: { label: string; cells: string[] }[] }) {
  return (
    <div className="compare-scroll">
      <table className="compare">
        <thead>
          <tr>
            <th scope="col" aria-label="Item" />
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {columns.map((_, i) => (
                <td key={i}>{r.cells[i] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tree({ nodes }: { nodes: DiagramNode[] }) {
  const children = (parent: number) => nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.parent === parent);
  const branch = (parent: number, depth: number): ReactNode => {
    const kids = children(parent);
    if (!kids.length) return null;
    return (
      <ul className={depth === 0 ? "tree" : "tree-branch"}>
        {kids.map(({ n, i }) => (
          <li key={i} className={depth === 0 ? "tree-root" : "tree-node"}>
            <span className="tree-card">
              <span className="flow-label">{n.label}</span>
              {n.detail && <span className="flow-detail">{n.detail}</span>}
            </span>
            {branch(i, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };
  return branch(-1, 0);
}

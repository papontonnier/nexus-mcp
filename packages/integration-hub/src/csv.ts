export type CsvColumn = { name: string; inferredType: "string" | "number" | "boolean"; missing: number; examples: string[] };
export type CsvAnalysis = { format: "csv"; rowCount: number; columns: CsvColumn[]; delimiter: string };

function parseRows(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === "") quoted = !quoted;
      else throw new Error("Unexpected quote in CSV");
    } else if (ch === delimiter && !quoted) { row.push(field); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (row.length || field !== "") { row.push(field); rows.push(row); }
  return rows;
}
export function analyzeCsv(input: string, delimiter = ","): CsvAnalysis {
  if (delimiter.length !== 1 || ['"',"\r","\n"].includes(delimiter)) throw new Error("Invalid delimiter");
  const rows = parseRows(input.replace(/^\uFEFF/, ""), delimiter);
  if (!rows.length || !rows[0].length || rows[0].every(h => !h.trim())) throw new Error("Missing CSV header");
  const headers = rows[0];
  if (new Set(headers).size !== headers.length || headers.some(h => !h.trim())) throw new Error("CSV headers must be unique and nonempty");
  const data = rows.slice(1);
  if (data.some(r => r.length !== headers.length)) throw new Error("Inconsistent CSV column count");
  const columns = headers.map((name, index): CsvColumn => {
    const values = data.map(row => row[index].trim());
    const nonempty = values.filter(Boolean);
    const inferredType = nonempty.length && nonempty.every(v => /^(true|false)$/i.test(v)) ? "boolean"
      : nonempty.length && nonempty.every(v => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(v)) ? "number" : "string";
    return { name, inferredType, missing: values.length - nonempty.length, examples: [...new Set(nonempty)].slice(0, 3) };
  });
  return { format: "csv", rowCount: data.length, columns, delimiter };
}

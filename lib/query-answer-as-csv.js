import { mkConfig, generateCsv, asString } from "export-to-csv";

/**
 * Converts query bindings to a raw csv table
 */
export default function queryAnswerAsCsv(queryResult) {
  const bindings = queryResult.results.bindings;
  const headers = queryResult.head.vars;
  return bindingsAndHeadersAsCsv( bindings, headers );
}

/**
 * Converts query bindings and haaders into a CSV table.
 */
export function bindingsAndHeadersAsCsv( bindings, headers ) {
  const generator = generateCsv(mkConfig({columnHeaders: headers}));
  const unpackedBindings = bindings.map((binding) => {
    const unpacked = {};
    for (let key in binding) {
      unpacked[key] = binding[key].value;
    }
    return unpacked;
  });

  return asString( generator( unpackedBindings ) );
}

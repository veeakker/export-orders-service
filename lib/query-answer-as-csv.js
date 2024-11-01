import { mkConfig, generateCsv, asString } from "export-to-csv";

/**
 * Converts query bindings to a raw csv table
 */
export default function queryAnswerAsCsv(queryResult) {
    const bindings = queryResult.results.bindings;
    const headers = queryResult.head.vars;
    const unpackedBindings = bindings
        .map((binding) => {
            const unpacked = {};
            for (let key in binding) {
                unpacked[key] = binding[key].value;
            }
            return unpacked;
        });

    let csvConfig = mkConfig({ columnHeaders: headers });
    const generator = generateCsv(csvConfig);
    return asString(generator(unpackedBindings));
}

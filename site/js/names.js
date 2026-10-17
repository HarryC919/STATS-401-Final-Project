// Display-only labels; stable airport IDs and reporting-carrier codes remain keys.
export function createNameLookup(airports = [], airlines = {}) {
  const airportNames = new Map(airports.map(row => [row.airport, row.name]));
  const label = (code, name) => name ? `${code} — ${name}` : code;
  return {
    airportLabel: code => label(code, airportNames.get(code)),
    airlineLabel: code => label(code, airlines[code]),
    airportCode(value) {
      const code = String(value).trim().split(/\s+—\s+/)[0].toUpperCase();
      return airportNames.has(code) ? code : null;
    },
    descriptions(text) {
      const value = String(text).trim();
      // Resolve code labels/lists, never incidental state abbreviations in city names.
      if (!/^[A-Z0-9]{2,3}(?:\s*(?:→|,)\s*[A-Z0-9]{2,3})*$/.test(value)) return [];
      const codes = [...new Set(value.match(/\b[A-Z0-9]{2,3}\b/g) ?? [])];
      return codes.flatMap(code => airportNames.has(code) ? [label(code, airportNames.get(code))]
        : airlines[code] ? [label(code, airlines[code])] : []);
    },
  };
}

// Missing values never represent observed zero rates.
export function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function nationalRate(row) {
  return hasNumber(row?.delayed_arrivals) && Number(row.eligible_arrivals) > 0
    ? Number(row.delayed_arrivals) / Number(row.eligible_arrivals) : null;
}

export function causeTotals(rows, definitions) {
  return definitions.map(({key, label}) => {
    const observationKey = key.replace(/_minutes$/, "_observations");
    const observed = rows.filter(row => Number(row[observationKey]) > 0 && hasNumber(row[key]));
    return { label, value: observed.length ? observed.reduce((sum, row) => sum + Number(row[key]), 0) : null };
  });
}

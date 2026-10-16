function xml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Excel 2003 XML is a real, dependency-free Excel workbook and opens natively in Excel. */
export function createSalesExcel(report) {
  const headers = ["Record type", "Date", "Quote", "Customer", "Advisor", "Owner", "Dealer group", "Branch", "Brand", "Model", "Plan type", "Status", "Direct sale", "Follow-up outcome"];
  const names = new Map(report.leaderboard.map((row) => [row.advisorId, row.name]));
  const rows = report.rows.map((row) => [row.recordType, row.date, row.number, row.customer, names.get(row.advisorId) ?? row.advisorId, names.get(row.ownerId) ?? row.ownerId, row.dealerGroupId, row.branchId, row.brand, row.model, row.planType, row.status, row.directSale ? "Yes" : "No", row.followUpOutcome ?? ""]);
  const cell = (value) => `<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`;
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Sales Performance"><Table>${[headers, ...rows].map((row) => `<Row>${row.map(cell).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
}

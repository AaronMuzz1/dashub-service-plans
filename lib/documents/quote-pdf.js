const encoder = new TextEncoder();

function pdfText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, " ").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function money(cents) { return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100); }
function date(value) { return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }

function pageLines(plan, dealer) {
  const quote = plan.quote;
  const record = plan.quoteRecord;
  const lines = [
    [18, "Service Plan Quote"],
    [10, dealer.name || "Selling dealer"],
    [9, [dealer.address, dealer.phone, dealer.email].filter(Boolean).join(" | ") || "Dealer contact details not configured"],
    [9, `Quote ${record.number}  |  Issued ${date(record.issueDate)}  |  Expires ${date(record.expiryDate)}`],
    [12, "Customer and vehicle"],
    [10, `${quote.customer.firstName} ${quote.customer.lastName}  |  ${quote.customer.email}  |  ${quote.customer.mobile}`],
    [10, `${quote.vehicle.year} ${quote.vehicle.make} ${quote.vehicle.model}${quote.vehicle.variant ? ` ${quote.vehicle.variant}` : ""}  |  Registration ${quote.vehicle.registration || "Not supplied"}  |  VIN ${quote.vehicle.vin || "Unavailable"}`],
    [12, "Included services and predicted service points"],
  ];
  for (const service of quote.services) {
    lines.push([10, `${service.number}. ${service.name} - predicted ${date(service.predictedDate)} at ${Number(service.scheduledKm).toLocaleString("en-NZ")} km`]);
    if (service.description) lines.push([9, `   Inclusions: ${service.description}`]);
  }
  lines.push([12, `Total Service Plan value: ${money(quote.funding.totalCents)}`]);
  lines.push([10, "Payment options"]);
  for (const option of Object.values(quote.paymentOptions)) {
    lines.push([10, `${option.label}: ${money(option.installmentCents)} from ${date(option.firstPaymentDate)} (${option.paymentCount} collections)`]);
  }
  lines.push([9, "Regular instalments shown above; the final instalment may be lower."]);
  lines.push([9, "Service Plan administered by Dashub"]);
  return lines;
}

/** Build a dependency-free, standards-valid one-page PDF for browser download/printing. */
export function createQuotePdf(plan, dealer = {}) {
  if (!plan?.quoteRecord?.number) throw new Error("Issue the quote before generating its PDF.");
  const lines = pageLines(plan, dealer);
  const pages = [[]];
  let y = 805;
  for (const [size, text] of lines) {
    if (y < 48) { pages.push([]); y = 805; }
    pages.at(-1).push([size, text, y]);
    y -= size >= 12 ? 23 : 17;
  }
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const stream = ["BT", "/F1 10 Tf", ...page.flatMap(([size, text, position]) => [`/F1 ${size} Tf`, `1 0 0 1 44 ${position} Tm`, `(${pdfText(text).slice(0, 112)}) Tj`]), "ET"].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encoder.encode(pdf);
}

export function quotePdfFilename(plan) {
  return `${plan.quoteRecord.number}-service-plan-quote.pdf`;
}

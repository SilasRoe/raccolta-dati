export interface PdfDataRow {
  id: number;
  pdfName: string;
  fullPath: string;
  docType: "auftrag" | "rechnung";
  confirmed: boolean;
  warnings?: boolean;

  kunde?: string | null;
  lieferant?: string | null;
  datumAuftrag?: string | null;
  nummerAuftrag?: string | null;

  produkt?: string | null;
  menge?: number | null;
  einheit?: string | null;
  preis?: number | null;
  waehrung?: string | null;

  datumRechnung?: string | null;
  nummerRechnung?: string | null;
  gelieferteMenge?: number | null;

  anmerkungen?: string | null;
}
export interface AiProduct {
  produkt?: string | null;
  menge?: number | null;
  waehrung?: string | null;
  preis?: number | null;
  gelieferteMenge?: number | null;
}
export interface AiResponse {
  nummerRechnung?: string | null;
  produkte?: AiProduct[];
}

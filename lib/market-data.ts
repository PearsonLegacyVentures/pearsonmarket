export const STARTING_CASH_CENTS = 100_000; // US$1,000 in virtual cash per player
export const FEE_RATE = 0.0025;
export const TICK_MS = 40_000;

// Each line is a fictional economic analogue of one of the 20 BISX common-share
// lines in the October 2026 roster. Names, symbols, stories and prices are invented.
export const companies = [
  { symbol: "BLG", name: "Beacon Life Group", sector: "Insurance", tier: "mid", price: 1260, description: "A diversified life and retirement insurer with a growing regional book." },
  { symbol: "MCB", name: "Mariner Commercial Bank", sector: "Banking", tier: "large", price: 1840, description: "A commercial bank financing merchants, households and cross-island trade." },
  { symbol: "LRP", name: "Lantern Risk Partners", sector: "Insurance", tier: "mid", price: 910, description: "A broker whose profits turn on renewals and catastrophe cover." },
  { symbol: "SFG", name: "Straits Fuel Group", sector: "Energy", tier: "large", price: 1430, description: "Fuel terminals and distribution for boats, generators and road transport." },
  { symbol: "SMT", name: "Seabright Mortgage", sector: "Banking", tier: "small", price: 720, description: "Home lending sensitive to rates, construction and employment." },
  { symbol: "PSA", name: "Palmshore Assurance", sector: "Insurance", tier: "mid", price: 1080, description: "Protection products for families and small businesses." },
  { symbol: "MHN", name: "Meridian Health Network", sector: "Healthcare", tier: "mid", price: 1570, description: "A network of clinics and a private hospital serving residents and visitors." },
  { symbol: "CTW", name: "ClearTide Water", sector: "Utilities", tier: "mid", price: 980, description: "Desalination and water delivery across several islands." },
  { symbol: "ASV", name: "Archipelago Savings", sector: "Banking", tier: "large", price: 1690, description: "A retail bank with deposits, cards and small-business loans." },
  { symbol: "WSC", name: "WaveSpan Communications", sector: "Telecom", tier: "large", price: 1160, description: "Broadband, television and enterprise connectivity." },
  { symbol: "RCS", name: "ReefCycle Services", sector: "Utilities", tier: "small", price: 540, description: "Waste pickup and recycling contracts with thin operating margins." },
  { symbol: "NQC", name: "North Quay Capital", sector: "Finance", tier: "small", price: 630, description: "A small investment firm with volatile fee income." },
  { symbol: "HCB", name: "Harbour Crest Bank", sector: "Banking", tier: "large", price: 1030, description: "A domestic bank exposed to credit cycles and public-sector flows." },
  { symbol: "PPT", name: "Portside Property Trust", sector: "Property", tier: "small", price: 880, description: "A portfolio of offices and retail properties with rent and vacancy risk." },
  { symbol: "SBF", name: "Shorebridge Finance", sector: "Finance", tier: "mid", price: 765, description: "Consumer and business lender focused on credit quality." },
  { symbol: "MCS", name: "Market Cove Stores", sector: "Retail", tier: "large", price: 1360, description: "Food markets balancing tourism demand, imports and grocery margins." },
  { symbol: "SWI", name: "Stormwatch Insurance", sector: "Insurance", tier: "mid", price: 1120, description: "Property and general insurance exposed to storm seasons." },
  { symbol: "IGU", name: "Island Grid Utilities", sector: "Utilities", tier: "large", price: 2010, description: "Electric power generation and grid investments." },
  { symbol: "SBC", name: "Sunward Beverage Co", sector: "Beverages", tier: "small", price: 850, description: "Local drinks and distribution tied to hospitality and consumer spending." },
  { symbol: "PML", name: "Port Meridian Logistics", sector: "Transport", tier: "large", price: 1790, description: "Port services whose volumes follow tourism, imports and construction." },
] as const;

export type Tier = "large" | "mid" | "small";
export const reserveCents: Record<Tier, number> = {
  large: 200_000_000, // US$2m quote side
  mid: 100_000_000,   // US$1m quote side
  small: 50_000_000,  // US$500k quote side
};

// Routine bot orders provide modest executed volume. Only labeled news events
// carry larger size, scaled to each pool's depth so small stocks do not jump
// from the same cash ticket as a large stock.
export function botTicketCents(poolCashCents:number, event:boolean, roll:number) {
  return event
    ? Math.floor(poolCashCents*(.0025+roll*.0025))
    : 5_000+Math.floor(roll*25_000);
}

export const eventTemplates: Record<string, { up: string[]; down: string[] }> = {
  Banking: { up: ["Loan arrears ease as households catch up on payments", "New business lending outpaces forecasts"], down: ["Higher rates spark worries over loan repayments", "Banking regulator calls for larger loss provisions"] },
  Insurance: { up: ["Renewals climb after a quiet claims quarter", "Reinsurance terms improve ahead of renewal season"], down: ["Storm forecast raises expected claims", "Claims costs rise after a rough weather week"] },
  Energy: { up: ["Marine fuel demand rises with visitor traffic", "Supply contract expands across the islands"], down: ["Fuel shipment delay raises distribution costs", "Margin pressure follows a sharp change in oil prices"] },
  Healthcare: { up: ["New clinic openings boost patient volumes", "Visitor health contracts beat expectations"], down: ["Staffing costs squeeze hospital margins", "Equipment outage interrupts elective services"] },
  Utilities: { up: ["Infrastructure contract wins approval", "Plant efficiency improves operating outlook"], down: ["Maintenance issue interrupts island service", "Capital spending estimate rises unexpectedly"] },
  Telecom: { up: ["Broadband subscriptions accelerate", "Enterprise network contract announced"], down: ["Service outage triggers customer churn fears", "Network upgrade runs over budget"] },
  Finance: { up: ["Fee income beats quarterly expectations", "Delinquencies fall in the latest credit report"], down: ["Consumer credit losses rise", "A large client delays an investment mandate"] },
  Property: { up: ["New tenants lift occupancy", "Commercial rents rise on strong demand"], down: ["Anchor tenant signals departure", "Refinancing costs weigh on property valuations"] },
  Retail: { up: ["Holiday grocery sales exceed forecasts", "Supplier deal lowers import costs"], down: ["Shipping costs push grocery margins lower", "Weak household spending surprises retailers"] },
  Beverages: { up: ["Hotel orders lift beverage shipments", "New distribution deal wins shelf space"], down: ["Input costs rise for local producers", "Tourism slowdown hits drink orders"] },
  Transport: { up: ["Cruise arrivals and cargo volumes jump", "Port expansion opens ahead of schedule"], down: ["Storm disruption delays cargo handling", "Lower cruise calls weaken port volumes"] },
};

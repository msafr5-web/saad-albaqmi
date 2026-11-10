// Legacy (JSONB) tables used by the running application. Do not remove until the data migration to the relational schema is done.
export * from "./education";

// Relational schema (database "saad_albaqmi"): constraints, foreign keys and money in halalas.
export * from "./core";
export * from "./hr";
export * from "./academic";
export * from "./finance";
export * from "./inventory";
export * from "./procurement";
export * from "./security";
export * from "./requests";

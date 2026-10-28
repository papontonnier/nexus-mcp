// Fictitious general-ledger extract used to try the module. Includes deliberate anomalies.
export const SAMPLE_DATASET = [
  "Société;N° pièce;Date comptable;Compte;Centre de coût;Libellé;Débit;Crédit;Devise",
  "FR01;VE-0001;05/01/2026;411000;CC100;Facture ACME;1 200,00;;EUR",
  "FR01;VE-0001;05/01/2026;706000;CC100;Facture ACME;;1 000,00;EUR",
  "FR01;VE-0001;05/01/2026;445710;CC100;TVA collectée;;200,00;EUR",
  "FR01;AC-0042;18/01/2026;606100;CC200;Fournitures;150,50;;EUR",
  "FR01;AC-0042;18/01/2026;401000;CC200;Fournitures;;150,50;EUR",
  "fr01 ;BQ-0007;03/03/2026;512000;;Encaissement ACME;1 200,00;;eur",
  "FR01;BQ-0007;03/03/2026;411000;;Encaissement ACME;;1 200,00;EUR",
  "DE01;VE-0100;15/03/2026;411000;CC300;Rechnung 100;500,00;;EUR",
  "DE01;VE-0100;15/03/2026;706000;CC300;Rechnung 100;;500,00;EUR",
  "DE01;VE-0101;31/02/2026;706000;CC300;Rechnung 101;;abc;EUR"
].join("\n");

-- D-093: retire presentation-only institution metadata for all active and archived assets.
-- No financial institution table exists. Dropping these columns also removes their
-- dependent checks/indexes; RESTRICT deliberately refuses unexpected external dependencies.
-- Asset identity, user names, owners, versions, postings and card settings are unchanged.
alter table asset drop column financial_institution_code;
alter table asset drop column card_issuer_code;

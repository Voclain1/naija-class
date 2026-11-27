ALTER TABLE messaging_termii_inbox
    ADD COLUMN charged_kobo INTEGER CHECK (charged_kobo >= 0),
    ADD COLUMN billing_contract_ref TEXT,
    ADD CONSTRAINT messaging_termii_charge_requires_contract
        CHECK ((charged_kobo IS NULL) = (billing_contract_ref IS NULL));

alter table card_setting
    add constraint ck_card_setting_settlement_asset_required
    check (settlement_asset_id is not null) not valid;

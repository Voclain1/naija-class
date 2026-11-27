-- Platform aggregate only. This table contains no school or recipient data.
CREATE TABLE messaging_platform_reservations_daily (
    day DATE PRIMARY KEY,
    reserved_kobo BIGINT NOT NULL CHECK (reserved_kobo >= 0)
);

BEGIN TRANSACTION;

PRAGMA foreign_keys = OFF;

ALTER TABLE monitor_tls_info RENAME TO monitor_tls_info_old;

CREATE TABLE monitor_tls_info (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	monitor_id INTEGER NOT NULL REFERENCES [monitor] ([id]) ON DELETE CASCADE ON UPDATE CASCADE,
	info_json TEXT
);

INSERT INTO monitor_tls_info (id, monitor_id, info_json)
SELECT id, monitor_id, info_json FROM monitor_tls_info_old;

DROP TABLE monitor_tls_info_old;

PRAGMA foreign_keys = ON;

COMMIT;

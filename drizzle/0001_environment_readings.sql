CREATE TABLE `environment_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`sensor_id` text NOT NULL,
	`pressure_hpa` real NOT NULL,
	`temperature_c` real,
	`humidity_pct` real,
	`measured_at` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_environment_station_time` ON `environment_readings` (`station_id`,`measured_at`);

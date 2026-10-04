CREATE TABLE `detector_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`station_name` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`signal` real NOT NULL,
	`source` text NOT NULL,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_detector_events_occurred_at` ON `detector_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_detector_events_station_time` ON `detector_events` (`station_id`,`occurred_at`);
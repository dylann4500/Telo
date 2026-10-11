CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`direction` text NOT NULL,
	`kind` text DEFAULT 'business' NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`org_key` text,
	`target_name` text NOT NULL,
	`target_phone` text,
	`purpose` text NOT NULL,
	`brief` text,
	`instructions` text,
	`status` text NOT NULL,
	`status_detail` text,
	`provider` text,
	`provider_call_id` text,
	`started_at` integer,
	`answered_at` integer,
	`ended_at` integer,
	`duration_sec` integer,
	`end_reason` text,
	`transcript` text NOT NULL,
	`recording_url` text,
	`analysis` text,
	`analyzed_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calls_provider_call_idx` ON `calls` (`provider_call_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calls_leg_idx` ON `calls` (`task_id`,`seq`,`attempt`);--> statement-breakpoint
CREATE INDEX `calls_task_idx` ON `calls` (`task_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`call_id` text,
	`org_key` text,
	`type` text NOT NULL,
	`summary` text NOT NULL,
	`data` text NOT NULL,
	`typed` text,
	`occurred_at` integer NOT NULL,
	`memory_synced_at` integer,
	`memory_sync_error` text,
	`memory_sync_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_task_idx` ON `events` (`task_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `events_org_idx` ON `events` (`user_id`,`org_key`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `events_sync_idx` ON `events` (`memory_synced_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`direction` text NOT NULL,
	`channel` text NOT NULL,
	`kind` text DEFAULT 'chat' NOT NULL,
	`body` text NOT NULL,
	`dedupe_key` text,
	`provider` text,
	`provider_message_id` text,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_dedupe_idx` ON `messages` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_provider_idx` ON `messages` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `messages_user_idx` ON `messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`aliases` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`fields` text NOT NULL,
	`options` text NOT NULL,
	`context` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`answer` text,
	`answered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `questions_task_idx` ON `questions` (`task_id`,`status`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`request` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`status_detail` text,
	`category` text,
	`goal` text,
	`source_ref` text,
	`org_key` text,
	`targets` text NOT NULL,
	`facts` text NOT NULL,
	`constraints` text NOT NULL,
	`authority` text,
	`plan` text,
	`memory` text,
	`result` text,
	`follow_up` text,
	`version` integer DEFAULT 0 NOT NULL,
	`step_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_user_status_idx` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`channel` text DEFAULT 'sms' NOT NULL,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`preferences` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`received_at` integer NOT NULL,
	`processed_at` integer
);

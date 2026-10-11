CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`from_domain` text,
	`received_at` integer,
	`subject` text,
	`business` text,
	`org_key` text,
	`kind` text,
	`summary` text,
	`amount_cents` integer,
	`confirmation_number` text,
	`task_id` text,
	`needs_call` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `emails_task_idx` ON `emails` (`task_id`);
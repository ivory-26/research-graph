CREATE TABLE "approval_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"execution_claim_id" uuid NOT NULL,
	"gate_seq" integer NOT NULL,
	"offered_spec" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_event_seq" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_gates_experiment_gate_seq_unique" UNIQUE("experiment_id","gate_seq"),
	CONSTRAINT "approval_gates_execution_claim_unique" UNIQUE("execution_claim_id"),
	CONSTRAINT "approval_gates_status_values" CHECK ("approval_gates"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "approval_gates_decision_consistent" CHECK (("approval_gates"."status" = 'pending' and "approval_gates"."decided_by" is null and "approval_gates"."decided_at" is null and "approval_gates"."decision_event_seq" is null) or ("approval_gates"."status" in ('approved', 'rejected') and "approval_gates"."decided_by" is not null and "approval_gates"."decided_at" is not null and "approval_gates"."decision_event_seq" is not null))
);
--> statement-breakpoint
CREATE TABLE "execution_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	CONSTRAINT "execution_claims_experiment_unique" UNIQUE("experiment_id"),
	CONSTRAINT "execution_claims_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "execution_claims_id_scope_unique" UNIQUE("id","experiment_id","workspace_id"),
	CONSTRAINT "execution_claims_expiry_after_claim" CHECK ("execution_claims"."expires_at" > "execution_claims"."claimed_at"),
	CONSTRAINT "execution_claims_close_consistent" CHECK (("execution_claims"."closed_at" is null and "execution_claims"."close_reason" is null) or ("execution_claims"."closed_at" is not null and "execution_claims"."close_reason" is not null)),
	CONSTRAINT "execution_claims_close_reason_values" CHECK ("execution_claims"."close_reason" is null or "execution_claims"."close_reason" in ('completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_events_experiment_seq_unique" UNIQUE("experiment_id","seq"),
	CONSTRAINT "pipeline_events_seq_positive" CHECK ("pipeline_events"."seq" > 0),
	CONSTRAINT "pipeline_events_event_seq_matches" CHECK (("pipeline_events"."event" ->> 'seq')::integer = "pipeline_events"."seq"),
	CONSTRAINT "pipeline_events_event_experiment_matches" CHECK ("pipeline_events"."event" ->> 'experimentId' = "pipeline_events"."experiment_id"::text),
	CONSTRAINT "pipeline_events_event_type_matches" CHECK ("pipeline_events"."event" ->> 'type' = "pipeline_events"."type")
);
--> statement-breakpoint
--> Hand-reordered from the generated file: the composite foreign keys below
--> reference experiments(id, workspace_id), so its unique constraint must
--> exist first. This migration had not been applied when the lines moved.
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_id_workspace_id_unique" UNIQUE("id","workspace_id");--> statement-breakpoint
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_experiment_workspace_fk" FOREIGN KEY ("experiment_id","workspace_id") REFERENCES "public"."experiments"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_claim_scope_fk" FOREIGN KEY ("execution_claim_id","experiment_id","workspace_id") REFERENCES "public"."execution_claims"("id","experiment_id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_gate_event_fk" FOREIGN KEY ("experiment_id","gate_seq") REFERENCES "public"."pipeline_events"("experiment_id","seq") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_decision_event_fk" FOREIGN KEY ("experiment_id","decision_event_seq") REFERENCES "public"."pipeline_events"("experiment_id","seq") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_claims" ADD CONSTRAINT "execution_claims_experiment_workspace_fk" FOREIGN KEY ("experiment_id","workspace_id") REFERENCES "public"."experiments"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_events" ADD CONSTRAINT "pipeline_events_experiment_workspace_fk" FOREIGN KEY ("experiment_id","workspace_id") REFERENCES "public"."experiments"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_gates_one_pending_per_experiment" ON "approval_gates" USING btree ("experiment_id") WHERE "approval_gates"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "pipeline_events_experiment_type_idx" ON "pipeline_events" USING btree ("experiment_id","type");
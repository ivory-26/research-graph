ALTER TABLE "approval_gates" DROP CONSTRAINT "approval_gates_execution_claim_unique";--> statement-breakpoint
ALTER TABLE "approval_gates" ADD COLUMN "repair_parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_repair_parent_run_id_runs_id_fk" FOREIGN KEY ("repair_parent_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_gates_initial_claim_unique" ON "approval_gates" USING btree ("execution_claim_id") WHERE "approval_gates"."repair_parent_run_id" is null;--> statement-breakpoint
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_claim_repair_parent_unique" UNIQUE("execution_claim_id","repair_parent_run_id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_experiment_parent_unique" UNIQUE("experiment_id","parent_run_id");
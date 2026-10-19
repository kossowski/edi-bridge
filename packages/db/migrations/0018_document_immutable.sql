CREATE FUNCTION "refuse_document_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A stored Document cannot be changed' USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "documents_immutable" BEFORE UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION "refuse_document_update"();

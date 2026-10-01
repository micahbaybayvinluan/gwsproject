-- CreateTable
CREATE TABLE "form_numbers_released" (
    "id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "no" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_numbers_released_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_numbers_released_doc_type_scope_key_no_key" ON "form_numbers_released"("doc_type", "scope_key", "no");


Here is the persona-based use case tailored to transform Mars Snacking / Royal Canin’s legacy Automation Anywhere process into a GenAI-driven order processing solution powered by Gemini.

---

### **Use Case: Autonomous Order Processing & Exception Management**

#### **1. Target User Persona**

* **Role:** Customer Service Specialist (RC CNE Customer Service Team)
* **Goal:** Process high-volume, unstructured customer order PDFs (e.g., Maxi Zoo) quickly without manual file routing or spreadsheet cross-referencing.
* **Pain Point:** High annual order volume (11,000+ orders/year, growing 40% YoY) causes manual bottlenecks, OCR extraction failures, and frequent exceptions when mapping item numbers (Minos) or store numbers (Markt).

---

#### **2. Multi-Agent Architecture (2 Gemini Agents)**

##### **Agent 1: Ingestion & Extraction Agent (Document Intelligence)**

* **Responsibility:** Ingests incoming order emails/PDFs directly from shared mailboxes or UI uploads. It uses Gemini's multimodal capabilities to extract structured metadata (Markt store ID, Order Number, Order Date, Supplier Item Numbers, Quantities) regardless of formatting changes.
* **Key Function:** Replaces rigid OCR rules with flexible contextual parsing, eliminating failures caused by PDF visual layout shifts.

##### **Agent 2: Validation & Reconciliation Agent (Master Data & Exception Resolution)**

* **Responsibility:** Validates extracted fields against SharePoint master lists (Client List, Item List mapping Minos to product descriptions/PSR/VET types). Automatically resolves minor typos or missing codes, flags unresolvable exceptions with clear diagnostic notes, and prepares the final Excel/JSON payload.
* **Key Function:** Automates cross-referencing, generates standardized output files, and creates ready-to-review exception tasks for human review.

---

#### **3. End-to-End User Story & Workflow**

1. **Trigger:** An order PDF arrives in the system (either auto-synced from `zamowienia@royalcanin.com` or uploaded via the UI by the Customer Service Specialist).
2. **Extraction:** **Agent 1** processes the raw PDF, accurately extracting key fields (Markt: 3729, Order Number: 4604568571, Item IDs, Quantities) in real time.
3. **Validation & Lookup:** **Agent 2** queries master lookup tables to match Supplier Item Numbers with internal Minos IDs and product classifications (PSR/VET).
4. **Human-in-the-Loop Review (Frontend UI):**
* **Happy Path:** Orders with 100% confidence are verified and structured automatically into the required output template for processing.
* **Exception Path:** If an item code or Markt store number is missing or unmapped, the UI highlights the exact discrepancy alongside the original PDF context so the Customer Service Specialist can resolve it in one click.


5. **Final Output:** The validated order payload is saved to target SharePoint folders (`Bot_Processed`) and integrated directly with downstream fulfillment systems.

---

### **System Architecture Requirements for App Development**

* **Frontend (User Interface):**
* **Dashboard:** Order processing status, volume metrics, and high-level health indicators.
* **Interactive Document Viewer:** Split-screen view displaying the raw PDF alongside Gemini-extracted fields for rapid human verification.
* **Exception Handling Workspace:** Highlighted review queue for flagged orders (e.g., missing Minos mapping or unmapped Markt IDs) with quick inline editing.


* **Backend:**
* **API Layer:** RESTful endpoints for uploading files, triggering agent workflows, and fetching status.
* **Gemini Integration:** Orchestration layer coordinating **Agent 1** (Multimodal Ingestion) and **Agent 2** (Data Validation & Reconciliation).
* **Integration Connectors:** Connectors to read/write from SharePoint (`Bot_Input`, `Bot_Processed`, `Bot_Exceptions`) and email mailboxes.



---

# Supabase Experiment Logging Architecture

This document outlines the "Hot/Cold" time-series data pipeline designed to handle high-frequency 3-second logs while staying within Supabase Free Tier storage limits.

---

## 🚀 Strategy: Hot/Cold Data Split
The architecture balances real-time performance with long-term retention by separating data into two distinct paths.

### 1. The "Hot" Table: `short_term_logs`
Captures the raw data stream for real-time monitoring and high-resolution graphing (last 24–48 hours).

* **Schema**:
    * `id`: `uuid` (Primary Key)
    * `created_at`: `timestamptz` (Primary Key/Partition Key)
    * `data`: `jsonb` (Flexible storage for experiment variables like pressure and status flags)
* **Partitioning**: Uses **Native PostgreSQL Partitioning** via the `pg_partman` extension.
* **Sliding Window**: 
    * **Interval**: 24-hour partitions.
    * **Retention**: 48-hour window (2 days).
    * **Automation**: `pg_cron` runs maintenance hourly to drop partitions older than 48 hours and pre-allocate the next day's table.

### 2. The "Cold" Table: `long_term_logs` (Historical)
Ensures data survives the 48-hour purge by storing lower-resolution pressure summaries.

* **Schema**:
    * `id`: `uuid` (Primary Key)
    * `avg_pressure`: `float` (The mathematical average of the pressure metric)
    * `recorded_at`: `timestamptz` (Truncated to the minute)
* **Aggregation Logic**: A SQL function (`aggregate_short_to_long`) extracts the scientific notation string from the JSONB `data` column, casts it to a `FLOAT`, and averages it.
* **Efficiency**: Reduces storage by **20x** (from ~28,800 rows/day to 1,440 rows/day), enabling months of tracking without hitting storage quotas.



---

## 🛠 Automation & Security
The architecture is "set and forget," powered by three core PostgreSQL features:

| Tool | Role | Description |
| :--- | :--- | :--- |
| **`pg_partman`** | Partition Manager | Automatically creates/drops physical table segments based on time. |
| **`pg_cron`** | Job Scheduler | Triggers the 1-minute aggregation and 1-hour maintenance tasks. |
| **RLS Policies** | Security | Policies defined once on the **parent** table automatically inherit to all child partitions. |

---

## 📊 Usage Guide

### Real-time Monitoring
Subscribe to `short_term_logs` using the **Supabase Realtime SDK** for updates every 3 seconds.

### Graphing (Toggle Logic)
* **Short-Term View (Live)**: Query `short_term_logs`. Postgres automatically scans only the relevant partitions for maximum speed.
* **Historical View (Trends)**: Query `long_term_logs` to view weeks of pressure trends at a glance.

---

## 📝 Maintenance & Controls
* **Resetting Data**: Call the `reset_experiment()` RPC to truncate tables and start fresh.
* **Monitoring Jobs**: Check `cron.job_run_details` to verify the success of the 1-minute aggregation heartbeats.
"""The two Royal Canin CNE order-processing agents, packaged for deployment.

This package is the unit that gets deployed to Vertex AI Agent Engine, and it is
also present on the Cloud Run image. That is deliberate: the deterministic tools
in `tools.py` and the master data beside them are used in two places, and they
have to agree exactly.

* Inside Agent Engine, agent 2 calls those tools to investigate an order.
* On Cloud Run, `backend/reconcile.py` re-runs the same functions as an authority
  pass, so the figures the UI shows are recomputed rather than generated.

If the two copies could drift, that guarantee would be worthless, so there is
only one copy.

The agent objects are deliberately not re-exported here. Each module exposes its
agent as `root_agent`, following the ADK convention, which leaves
`agent_pkg.extraction_agent` unambiguously the module: the backend imports it for
`profile()`, and the deploy script imports `root_agent` from it.
"""

from . import extraction_agent, validation_agent

__all__ = ["extraction_agent", "validation_agent"]

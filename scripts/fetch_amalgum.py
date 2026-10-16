"""Obtain reviewed, officially distributed files via Git; never crawl source sites."""
from pathlib import Path
import subprocess
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.adapters import AMALGUM_COMMIT, GENRES

root=Path(__file__).resolve().parents[1] / "data" / "amalgum"
if not root.exists():
    subprocess.run(["git","clone","--filter=blob:none","--sparse","--no-checkout",
                    "https://github.com/gucorpling/amalgum.git",str(root)],check=True)
elif not (root / ".git").exists():
    raise SystemExit(f"Existing directory is not a corpus checkout: {root}")
dirty=subprocess.check_output(["git","-C",str(root),"status","--porcelain"],text=True)
if dirty.strip():
    raise SystemExit("Existing corpus checkout has local changes; inspect before changing it")
dirs=[f"amalgum/{g}/{d}" for g in GENRES for d in ("dep","xml")]
subprocess.run(["git","-C",str(root),"sparse-checkout","set",*dirs],check=True)
subprocess.run(["git","-C",str(root),"checkout",AMALGUM_COMMIT],check=True)
print(root)

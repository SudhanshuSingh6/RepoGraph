import math

from neo4j import AsyncDriver


async def get_metrics(driver: AsyncDriver, repo_id: str) -> dict:
    """Lightweight count endpoint consumed by all dashboards."""
    async with driver.session() as session:
        totals = await session.run(
            """
            MATCH (n:Node {repo_id: $id})
            RETURN
              count(CASE WHEN n:Package THEN 1 END)     AS packages,
              count(CASE WHEN n:File    THEN 1 END)     AS files,
              count(CASE WHEN n:Class   THEN 1 END)     AS classes,
              count(CASE WHEN n:Method  THEN 1 END)     AS methods,
              count(CASE WHEN n:ExternalLib THEN 1 END) AS external_deps
            """,
            id=repo_id,
        )
        row = await totals.single()
        base = dict(row) if row else {}

        imports_r = await session.run(
            "MATCH (a:Node {repo_id:$id})-[r:IMPORTS]->(b:Node {repo_id:$id}) "
            "RETURN count(r) AS cnt",
            id=repo_id,
        )
        imports_row = await imports_r.single()
        imports_count = imports_row["cnt"] if imports_row else 0

        calls_r = await session.run(
            "MATCH (a:Node {repo_id:$id})-[r:CALLS]->(b:Node {repo_id:$id}) RETURN count(r) AS cnt",
            id=repo_id,
        )
        calls_row = await calls_r.single()
        calls_count = calls_row["cnt"] if calls_row else 0

        cycles_r = await session.run(
            """
            MATCH (a:File {repo_id: $id})
            MATCH path = (a)-[:IMPORTS*2..8]->(a)
            RETURN count(path) AS cnt
            """,
            id=repo_id,
        )
        cycles_row = await cycles_r.single()
        cycles_count = cycles_row["cnt"] if cycles_row else 0

    return {
        "packages": base.get("packages", 0),
        "files": base.get("files", 0),
        "classes": base.get("classes", 0),
        "methods": base.get("methods", 0),
        "external_deps": base.get("external_deps", 0),
        "imports": imports_count,
        "calls": calls_count,
        "cycles": cycles_count,
    }


async def get_overview(driver: AsyncDriver, repo_id: str) -> dict:
    async with driver.session() as session:
        # 1. Aggregated totals + avg complexity
        totals_r = await session.run(
            """
            MATCH (n:Node {repo_id: $id})
            RETURN
              count(CASE WHEN n:Package     THEN 1 END) AS packages,
              count(CASE WHEN n:File        THEN 1 END) AS files,
              count(CASE WHEN n:Class       THEN 1 END) AS classes,
              count(CASE WHEN n:Method      THEN 1 END) AS methods,
              count(CASE WHEN n:ExternalLib THEN 1 END) AS external_deps,
              avg(CASE WHEN n:Method AND n.complexity IS NOT NULL
                  THEN toFloat(n.complexity) END) AS avg_complexity
            """,
            id=repo_id,
        )
        totals_row = await totals_r.single()
        totals = dict(totals_row) if totals_row else {}
        avg_complexity = totals.get("avg_complexity") or 0.0

        # 2. Complexity buckets
        buckets_r = await session.run(
            """
            MATCH (m:Method {repo_id: $id}) WHERE m.complexity IS NOT NULL
            RETURN
              CASE WHEN m.complexity <= 3  THEN '1-3'
                   WHEN m.complexity <= 7  THEN '4-7'
                   WHEN m.complexity <= 12 THEN '8-12'
                   ELSE '13+' END AS bucket,
              count(m) AS cnt
            """,
            id=repo_id,
        )
        complexity_dist: dict = {"1-3": 0, "4-7": 0, "8-12": 0, "13+": 0}
        async for record in buckets_r:
            complexity_dist[record["bucket"]] = record["cnt"]

        # 3. Largest packages
        pkgs_r = await session.run(
            """
            MATCH (p:Package {repo_id: $id})-[:CONTAINS]->(f:File)
            RETURN p.name AS name, p.id AS id, count(f) AS file_count
            ORDER BY file_count DESC LIMIT 5
            """,
            id=repo_id,
        )
        largest_packages = []
        async for record in pkgs_r:
            largest_packages.append(
                {"name": record["name"], "id": record["id"], "file_count": record["file_count"]}
            )

        # 4. Most connected classes
        classes_r = await session.run(
            """
            MATCH (c:Class {repo_id: $id})-[r]-()
            WHERE type(r) <> 'CONTAINS'
            RETURN c.name AS name, c.id AS id, count(r) AS edge_count
            ORDER BY edge_count DESC LIMIT 5
            """,
            id=repo_id,
        )
        most_connected = []
        async for record in classes_r:
            most_connected.append(
                {"name": record["name"], "id": record["id"], "edge_count": record["edge_count"]}
            )

        # 5. High complexity methods (for warnings)
        high_cx_r = await session.run(
            """
            MATCH (m:Method {repo_id: $id})
            WHERE m.complexity IS NOT NULL AND m.complexity > 15
            RETURN m.name AS name, m.complexity AS complexity
            ORDER BY m.complexity DESC LIMIT 5
            """,
            id=repo_id,
        )
        high_cx = []
        async for record in high_cx_r:
            high_cx.append({"name": record["name"], "complexity": record["complexity"]})

        # 6. High fan-out classes
        fan_out_r = await session.run(
            """
            MATCH (c:Class {repo_id: $id})-[:CALLS]->(m:Method)
            WITH c, count(m) AS fan_out
            WHERE fan_out > 15
            RETURN c.name AS name, fan_out
            ORDER BY fan_out DESC LIMIT 5
            """,
            id=repo_id,
        )
        high_fan_out = []
        async for record in fan_out_r:
            high_fan_out.append({"name": record["name"], "fan_out": record["fan_out"]})

        # 7. Cycle count
        cycles_r = await session.run(
            """
            MATCH (a:File {repo_id: $id})
            MATCH path = (a)-[:IMPORTS*2..8]->(a)
            RETURN count(path) AS cnt
            """,
            id=repo_id,
        )
        cycles_row = await cycles_r.single()
        cycle_count = cycles_row["cnt"] if cycles_row else 0

        # 8. Node type distribution
        node_dist_r = await session.run(
            """
            MATCH (n:Node {repo_id: $id})
            RETURN
              count(CASE WHEN n:Package     THEN 1 END) AS Package,
              count(CASE WHEN n:File        THEN 1 END) AS File,
              count(CASE WHEN n:Class       THEN 1 END) AS Class,
              count(CASE WHEN n:Interface   THEN 1 END) AS Interface,
              count(CASE WHEN n:Enum        THEN 1 END) AS Enum,
              count(CASE WHEN n:Method      THEN 1 END) AS Method,
              count(CASE WHEN n:RestEndpoint THEN 1 END) AS RestEndpoint,
              count(CASE WHEN n:ExternalLib THEN 1 END) AS ExternalLib
            """,
            id=repo_id,
        )
        node_dist_row = await node_dist_r.single()
        node_type_distribution = dict(node_dist_row) if node_dist_row else {}

    largest_pkg = largest_packages[0] if largest_packages else {"name": "—", "file_count": 0}
    most_conn = most_connected[0] if most_connected else {"name": "—", "edge_count": 0}

    health, warnings = _compute_health(
        avg_complexity, cycle_count, largest_pkg.get("file_count", 0), high_cx, high_fan_out
    )

    return {
        "total_packages": totals.get("packages", 0),
        "total_files": totals.get("files", 0),
        "total_classes": totals.get("classes", 0),
        "total_methods": totals.get("methods", 0),
        "total_external_deps": totals.get("external_deps", 0),
        "avg_complexity": round(avg_complexity, 1),
        "largest_package": largest_pkg,
        "most_connected_class": most_conn,
        "health": health,
        "warnings": warnings,
        "charts": {
            "node_type_distribution": node_type_distribution,
            "complexity_distribution": complexity_dist,
            "largest_packages": largest_packages,
            "most_connected_classes": most_connected,
        },
    }


def _compute_health(avg_complexity, cycle_count, largest_pkg_size, high_cx, high_fan_out):
    score = 100
    warnings = []

    if cycle_count > 0:
        score -= min(cycle_count * 10, 30)
        noun = "dependency" if cycle_count == 1 else "dependencies"
        warnings.append(f"⚠ {cycle_count} circular {noun} detected")

    if avg_complexity > 10:
        score -= 15
    elif avg_complexity > 7:
        score -= 5

    for item in high_cx[:3]:
        warnings.append(f"⚠ {item['name']} complexity = {item['complexity']}")

    if largest_pkg_size > 30:
        score -= 10
    elif largest_pkg_size > 20:
        score -= 5

    for item in high_fan_out[:2]:
        warnings.append(f"⚠ {item['name']} fan-out = {item['fan_out']}")

    if largest_pkg_size > 20:
        warnings.append(f"⚠ Largest package has {largest_pkg_size} files")

    score = max(0, score)
    stars = math.ceil(score / 20) if score > 0 else 1

    if score >= 90:
        label = "Excellent"
    elif score >= 75:
        label = "Good"
    elif score >= 60:
        label = "Fair"
    elif score >= 40:
        label = "Poor"
    else:
        label = "Critical"

    health = {
        "score": score,
        "stars": stars,
        "label": label,
    }
    return health, warnings

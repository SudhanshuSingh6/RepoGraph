from neo4j import AsyncDriver


async def create_schema(driver: AsyncDriver) -> None:
    queries = [
        "CREATE CONSTRAINT node_id IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE",
        "CREATE CONSTRAINT repo_id IF NOT EXISTS FOR (r:Repo) REQUIRE r.id IS UNIQUE",
        # Vector index for Phase 5 embeddings
        """CREATE VECTOR INDEX node_embeddings IF NOT EXISTS
           FOR (n:Node) ON (n.embedding)
           OPTIONS { indexConfig: {
             `vector.dimensions`: 384,
             `vector.similarity_function`: 'cosine'
           }}""",
    ]
    async with driver.session() as session:
        for q in queries:
            try:
                await session.run(q)
            except Exception:
                pass  # constraint/index may already exist

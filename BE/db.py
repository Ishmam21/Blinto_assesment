import os

from sqlalchemy import create_engine, text

database_url = os.getenv("DATABASE_URL") or "postgresql://doomsday:doomsday_local@127.0.0.1:5432/doomsday"
database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
engine = create_engine(database_url, pool_pre_ping=True)

if __name__ == "__main__":
    with engine.connect() as connection:
        movie_count = connection.execute(
            text("SELECT COUNT(*) FROM movies")
        ).scalar_one()
        print(f"Connected to PostgreSQL. Movies in database: {movie_count}")

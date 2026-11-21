import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

database_url = os.environ["DATABASE_URL"]
database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
engine = create_engine(database_url)

if __name__ == "__main__":
    with engine.connect() as connection:
        movie_count = connection.execute(
            text("SELECT COUNT(*) FROM movies")
        ).scalar_one()
        print(f"Connected to Neon. Movies in database: {movie_count}")
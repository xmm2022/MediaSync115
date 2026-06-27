import assert from "node:assert/strict";
import { mapSearchItemToResource } from "../src/utils/searchResources.ts";

const movie = mapSearchItemToResource({
  id: 603,
  media_type: "movie",
  title: "The Matrix",
  release_date: "1999-03-31",
  vote_average: 8.2,
  poster_path: "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
  overview: "A hacker discovers reality is a simulation.",
});

assert.equal(movie.id, "603");
assert.equal(movie.tmdb_id, 603);
assert.equal(movie.media_type, "movie");
assert.equal(movie.category, "Movie");
assert.equal(movie.year, 1999);
assert.equal(movie.rating, 8.2);
assert.match(movie.poster, /image\.tmdb\.org/);

const tv = mapSearchItemToResource({
  id: 1399,
  media_type: "tv",
  name: "Game of Thrones",
  first_air_date: "2011-04-17",
});

assert.equal(tv.tmdb_id, 1399);
assert.equal(tv.title, "Game of Thrones");
assert.equal(tv.category, "TV");
assert.equal(tv.year, 2011);

console.log("search resource mapping tests passed");

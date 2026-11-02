# Crew Station

An isometric pixel-art space station in the browser. A crew of robots lives on it: they sit at desks when
the data says they are working, carry parcels when work changes hands, charge at night, and build the dock
block by block as projects close. A crew panel beside the station lists who is doing what.

It is static HTML, CSS and JavaScript with no build step and no backend. It reads one JSON file, and ships
with an invented sample board at `data/sample-board.json`.

## Run it

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/. Any static web server works. Opening `index.html` directly from disk does
not, because the page fetches JSON.

```sh
node tools/check.js
```

checks the tree: every referenced asset exists, nothing is left unreferenced, and the data agrees.

## Learn more

- [AGENTS.md](AGENTS.md): the full guide. Running and checking it, the board schema, live data, adding crew, rooms and
  desks, changing art, placing it in another project.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code is organized.
- [art-kit/](art-kit/ART-GUIDE.md): for making new art that matches: a style guide, wireframe guides for rooms and halls,
  sprite sheet templates, reference stills and scripts. The page does not load anything from it.

Useful URL switches: `?demo=1` rotates the crew states, `?night=1` forces night, `?board=<url>` reads another
board file. AGENTS.md lists them all.

## Acknowledgments

Thank you to Andrew Sims and [StarNet](https://github.com/androoAGI/starnet), which inspired this station. This project
includes no StarNet code or asset files.

## License

MIT, see [LICENSE](LICENSE). The VT323 font is under the SIL OFL 1.1; see [NOTICE.md](NOTICE.md).

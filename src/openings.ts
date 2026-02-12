export type PlayerColor = "w" | "b";

export interface OpeningPreset {
  id: string;
  name: string;
  description: string;
  seedMoves: string[];
  userColor: PlayerColor;
}

export const OPENINGS: OpeningPreset[] = [
  {
    id: "ruy-lopez",
    name: "Ruy Lopez",
    description: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6",
    seedMoves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"],
    userColor: "w",
  },
  {
    id: "italian-game",
    name: "Italian Game",
    description: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5",
    seedMoves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"],
    userColor: "w",
  },
  {
    id: "scotch-game",
    name: "Scotch Game",
    description: "1. e4 e5 2. Nf3 Nc6 3. d4 exd4",
    seedMoves: ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4", "e5d4"],
    userColor: "w",
  },
  {
    id: "four-knights-game",
    name: "Four Knights Game",
    description: "1. e4 e5 2. Nf3 Nc6 3. Nc3 Nf6",
    seedMoves: ["e2e4", "e7e5", "g1f3", "b8c6", "b1c3", "g8f6"],
    userColor: "w",
  },
  {
    id: "kings-gambit",
    name: "King's Gambit",
    description: "1. e4 e5 2. f4",
    seedMoves: ["e2e4", "e7e5", "f2f4"],
    userColor: "w",
  },
  {
    id: "queens-gambit",
    name: "Queen's Gambit",
    description: "1. d4 d5 2. c4",
    seedMoves: ["d2d4", "d7d5", "c2c4"],
    userColor: "w",
  },
  {
    id: "london-system",
    name: "London System",
    description: "1. d4 d5 2. Nf3 Nf6 3. Bf4 e6",
    seedMoves: ["d2d4", "d7d5", "g1f3", "g8f6", "c1f4", "e7e6"],
    userColor: "w",
  },
  {
    id: "english-opening",
    name: "English Opening",
    description: "1. c4 e5 2. Nc3 Nf6",
    seedMoves: ["c2c4", "e7e5", "b1c3", "g8f6"],
    userColor: "w",
  },
  {
    id: "catalan-opening",
    name: "Catalan Opening",
    description: "1. d4 Nf6 2. c4 e6 3. g3 d5",
    seedMoves: ["d2d4", "g8f6", "c2c4", "e7e6", "g2g3", "d7d5"],
    userColor: "w",
  },
  {
    id: "reti-opening",
    name: "Reti Opening",
    description: "1. Nf3 d5 2. c4",
    seedMoves: ["g1f3", "d7d5", "c2c4"],
    userColor: "w",
  },
  {
    id: "vienna-game",
    name: "Vienna Game",
    description: "1. e4 e5 2. Nc3 Nf6",
    seedMoves: ["e2e4", "e7e5", "b1c3", "g8f6"],
    userColor: "w",
  },
  {
    id: "kings-indian-attack",
    name: "King's Indian Attack",
    description: "1. Nf3 d5 2. g3 Nf6 3. Bg2 e6",
    seedMoves: ["g1f3", "d7d5", "g2g3", "g8f6", "f1g2", "e7e6"],
    userColor: "w",
  },
  {
    id: "dutch-defense",
    name: "Dutch Defense",
    description: "1. d4 f5",
    seedMoves: ["d2d4", "f7f5"],
    userColor: "b",
  },
  {
    id: "sicilian-defense",
    name: "Sicilian Defense",
    description: "1. e4 c5",
    seedMoves: ["e2e4", "c7c5"],
    userColor: "b",
  },
  {
    id: "french-defense",
    name: "French Defense",
    description: "1. e4 e6",
    seedMoves: ["e2e4", "e7e6"],
    userColor: "b",
  },
  {
    id: "caro-kann-defense",
    name: "Caro-Kann Defense",
    description: "1. e4 c6",
    seedMoves: ["e2e4", "c7c6"],
    userColor: "b",
  },
  {
    id: "queens-gambit-declined",
    name: "Queen's Gambit Declined",
    description: "1. d4 d5 2. c4 e6",
    seedMoves: ["d2d4", "d7d5", "c2c4", "e7e6"],
    userColor: "b",
  },
  {
    id: "kings-indian-defense",
    name: "King's Indian Defense",
    description: "1. d4 Nf6 2. c4 g6",
    seedMoves: ["d2d4", "g8f6", "c2c4", "g7g6"],
    userColor: "b",
  },
  {
    id: "nimzo-indian-defense",
    name: "Nimzo-Indian Defense",
    description: "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4",
    seedMoves: ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4"],
    userColor: "b",
  },
  {
    id: "slav-defense",
    name: "Slav Defense",
    description: "1. d4 d5 2. c4 c6",
    seedMoves: ["d2d4", "d7d5", "c2c4", "c7c6"],
    userColor: "b",
  },
  {
    id: "scandinavian-defense",
    name: "Scandinavian Defense",
    description: "1. e4 d5",
    seedMoves: ["e2e4", "d7d5"],
    userColor: "b",
  },
  {
    id: "petroff-defense",
    name: "Petroff Defense",
    description: "1. e4 e5 2. Nf3 Nf6",
    seedMoves: ["e2e4", "e7e5", "g1f3", "g8f6"],
    userColor: "b",
  },
  {
    id: "alekhine-defense",
    name: "Alekhine Defense",
    description: "1. e4 Nf6",
    seedMoves: ["e2e4", "g8f6"],
    userColor: "b",
  },
  {
    id: "pirc-defense",
    name: "Pirc Defense",
    description: "1. e4 d6 2. d4 Nf6 3. Nc3 g6",
    seedMoves: ["e2e4", "d7d6", "d2d4", "g8f6", "b1c3", "g7g6"],
    userColor: "b",
  },
  {
    id: "grunfeld-defense",
    name: "Grunfeld Defense",
    description: "1. d4 Nf6 2. c4 g6 3. Nc3 d5",
    seedMoves: ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "d7d5"],
    userColor: "b",
  },
];

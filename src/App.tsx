import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Chess, type Move, type Square } from "chess.js";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";
import { OPENINGS, type OpeningPreset, type PlayerColor } from "./openings";

type SpeedOption = "blitz" | "rapid" | "classical";

interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
}

interface ExplorerResponse {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening?: {
    eco: string;
    name: string;
  };
}

interface SessionConfig {
  opening: OpeningPreset;
  elo: number;
  eloRatings: string;
  speed: SpeedOption;
  botMoveThresholdPercent: number;
  alwaysPlayMostCommonMove: boolean;
}

interface WeightedMove {
  move: ExplorerMove;
  games: number;
  rate: number;
}

interface RankedMove {
  rank: number;
  uci: string;
  san: string;
  games: number;
  rate: number;
}

type MoveGrade = "!!" | "✓" | "x";

interface MoveReview {
  sideToMove: PlayerColor;
  playedSan: string;
  playedRank: number | null;
  playedRate: number;
  grade: MoveGrade;
  bestMove: RankedMove | null;
  alternatives: RankedMove[];
  rankedMoves: RankedMove[];
  totalGames: number;
}

const HIGH_ELO_RATINGS = "2000,2200,2500";
const ALTERNATIVE_RATE = 0.1;
const EXPLORER_RATING_BUCKETS = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
const BOT_MOVE_DELAY_MS = 1100;
const BRILLIANT_FLASH_MS = 1100;
const OPENING_SEARCH_RESET_MS = 20000;

function normalizeCastlingUci(uci: string): string {
  const normalized = uci.toLowerCase();

  if (normalized === "e1h1") {
    return "e1g1";
  }

  if (normalized === "e1a1") {
    return "e1c1";
  }

  if (normalized === "e8h8") {
    return "e8g8";
  }

  if (normalized === "e8a8") {
    return "e8c8";
  }

  return normalized;
}

function parseUci(uci: string): { from: Square; to: Square; promotion?: "q" | "r" | "b" | "n" } {
  const normalizedUci = normalizeCastlingUci(uci);
  const from = normalizedUci.slice(0, 2) as Square;
  const to = normalizedUci.slice(2, 4) as Square;
  const promotion =
    normalizedUci.length > 4 ? (normalizedUci.slice(4, 5) as "q" | "r" | "b" | "n") : undefined;

  return promotion ? { from, to, promotion } : { from, to };
}

function toUci(move: Move): string {
  return normalizeCastlingUci(`${move.from}${move.to}${move.promotion ?? ""}`);
}

function clampElo(rawValue: string): number {
  const parsed = Number.parseInt(rawValue, 10);

  if (Number.isNaN(parsed)) {
    return 1500;
  }

  return Math.min(3200, Math.max(400, parsed));
}

function clampPercent(rawValue: string, fallback: number): number {
  const parsed = Number.parseFloat(rawValue);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, parsed));
}

function formatPercentValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function colorLabel(color: PlayerColor): string {
  return color === "w" ? "White" : "Black";
}

function opponentColor(color: PlayerColor): PlayerColor {
  return color === "w" ? "b" : "w";
}

function describeGameOver(game: Chess): string {
  if (game.isCheckmate()) {
    return "Checkmate.";
  }

  if (game.isStalemate()) {
    return "Stalemate.";
  }

  if (game.isThreefoldRepetition()) {
    return "Draw by repetition.";
  }

  if (game.isInsufficientMaterial()) {
    return "Draw by insufficient material.";
  }

  if (game.isDraw()) {
    return "Draw.";
  }

  return "Game over.";
}

async function fetchExplorerMoves(
  moveHistoryUci: string[],
  ratings: string,
  speed: SpeedOption,
): Promise<ExplorerResponse> {
  const params = new URLSearchParams({
    variant: "standard",
    speeds: speed,
    ratings,
    moves: "50",
  });

  if (moveHistoryUci.length > 0) {
    params.set("play", moveHistoryUci.join(","));
  }

  const response = await fetch(`https://explorer.lichess.ovh/lichess?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Explorer request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as ExplorerResponse;
  return data;
}

function buildRankedMoves(explorer: ExplorerResponse): RankedMove[] {
  const totalAtPosition = explorer.white + explorer.draws + explorer.black;
  const baseMoves = explorer.moves
    .map((move) => {
      const games = move.white + move.draws + move.black;
      return { move, games };
    })
    .filter((entry) => entry.games > 0)
    .sort((a, b) => b.games - a.games);

  const denominator =
    totalAtPosition > 0 ? totalAtPosition : baseMoves.reduce((sum, entry) => sum + entry.games, 0);

  return baseMoves.map((entry, index) => ({
    rank: index + 1,
    uci: normalizeCastlingUci(entry.move.uci),
    san: entry.move.san,
    games: entry.games,
    rate: denominator > 0 ? entry.games / denominator : 0,
  }));
}

function chooseWeightedMove(
  explorer: ExplorerResponse,
  minMoveRatePercent: number,
  alwaysPlayMostCommonMove: boolean,
): {
  selected: ExplorerMove | null;
  selectedRate: number;
  usedFallbackPool: boolean;
} {
  const totalAtPosition = explorer.white + explorer.draws + explorer.black;

  const weightedMoves: WeightedMove[] = explorer.moves
    .map((move) => {
      const games = move.white + move.draws + move.black;
      return { move, games, rate: 0 };
    })
    .filter((entry) => entry.games > 0);

  const denominator =
    totalAtPosition > 0
      ? totalAtPosition
      : weightedMoves.reduce((sum, entry) => sum + entry.games, 0);

  for (const entry of weightedMoves) {
    entry.rate = denominator > 0 ? entry.games / denominator : 0;
  }

  if (alwaysPlayMostCommonMove) {
    if (weightedMoves.length === 0) {
      return { selected: null, selectedRate: 0, usedFallbackPool: false };
    }

    const mostCommon = weightedMoves.reduce((best, current) =>
      current.games > best.games ? current : best,
    );

    return {
      selected: mostCommon.move,
      selectedRate: mostCommon.rate,
      usedFallbackPool: false,
    };
  }

  const minRate = Math.max(0, minMoveRatePercent) / 100;
  const filtered = weightedMoves.filter((entry) => entry.rate > minRate);
  const pool = filtered.length > 0 ? filtered : weightedMoves;

  if (pool.length === 0) {
    return { selected: null, selectedRate: 0, usedFallbackPool: false };
  }

  const totalWeight = pool.reduce((sum, entry) => sum + entry.games, 0);

  if (totalWeight <= 0) {
    return {
      selected: pool[0].move,
      selectedRate: pool[0].rate,
      usedFallbackPool: filtered.length === 0,
    };
  }

  let threshold = Math.random() * totalWeight;

  for (const entry of pool) {
    threshold -= entry.games;
    if (threshold <= 0) {
      return {
        selected: entry.move,
        selectedRate: entry.rate,
        usedFallbackPool: filtered.length === 0,
      };
    }
  }

  return {
    selected: pool[pool.length - 1].move,
    selectedRate: pool[pool.length - 1].rate,
    usedFallbackPool: filtered.length === 0,
  };
}

function buildMoveReview(
  rankedMoves: RankedMove[],
  playedMove: Move,
  sideToMove: PlayerColor,
): MoveReview {
  const playedUci = toUci(playedMove);
  const playedEntry = rankedMoves.find((entry) => entry.uci === playedUci) ?? null;
  const playedRank = playedEntry?.rank ?? null;
  const playedRate = playedEntry?.rate ?? 0;
  const topRate = rankedMoves[0]?.rate ?? 0;

  let grade: MoveGrade = "x";
  if (playedEntry && topRate - playedRate <= 0.05) {
    grade = "!!";
  } else if (playedRate >= ALTERNATIVE_RATE) {
    grade = "✓";
  }

  const bestMove = rankedMoves[0] ?? null;
  const alternatives = rankedMoves.filter((entry) => entry.rank !== 1 && entry.rate >= ALTERNATIVE_RATE);
  const totalGames = rankedMoves.reduce((sum, entry) => sum + entry.games, 0);

  return {
    sideToMove,
    playedSan: playedMove.san,
    playedRank,
    playedRate,
    grade,
    bestMove,
    alternatives,
    rankedMoves,
    totalGames,
  };
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function getExplorerTotalGames(explorer: ExplorerResponse): number {
  const total = explorer.white + explorer.draws + explorer.black;
  if (total > 0) {
    return total;
  }

  return explorer.moves.reduce((sum, move) => sum + move.white + move.draws + move.black, 0);
}

function interpolateLogScale(
  value: number,
  lowGames: number,
  highGames: number,
  lowPercent: number,
  highPercent: number,
): number {
  const clampedValue = Math.min(highGames, Math.max(lowGames, value));
  const lowLog = Math.log10(lowGames);
  const highLog = Math.log10(highGames);
  const valueLog = Math.log10(clampedValue);

  if (highLog === lowLog) {
    return highPercent;
  }

  const ratio = (valueLog - lowLog) / (highLog - lowLog);
  return lowPercent + ratio * (highPercent - lowPercent);
}

function accuracyFromGames(totalGames: number): number {
  if (totalGames >= 10000) {
    return 100;
  }

  if (totalGames >= 1000) {
    return interpolateLogScale(totalGames, 1000, 10000, 50, 100);
  }

  if (totalGames >= 100) {
    return interpolateLogScale(totalGames, 100, 1000, 25, 50);
  }

  if (totalGames >= 11) {
    // Keep 11 games below 1% and scale smoothly up to 25% at 100 games.
    return interpolateLogScale(totalGames, 11, 100, 0.99, 25);
  }

  if (totalGames <= 10) {
    return 1;
  }

  return 100;
}

function formatPositionAccuracyLabel(totalGames: number | null, accuracyPercent: number): string {
  if (totalGames === null) {
    return "100%";
  }

  if (totalGames <= 10) {
    return ">1%";
  }

  if (accuracyPercent < 1) {
    return "<1%";
  }

  return `${formatPercentValue(accuracyPercent)}%`;
}

function getLastBotMoveSan(currentGame: Chess, botColor: PlayerColor): string {
  const history = currentGame.history({ verbose: true }) as Move[];

  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].color === botColor) {
      return history[index].san;
    }
  }

  return "";
}

function buildRatingsFilterFromTargetElo(targetElo: number): string {
  const rangeMin = Math.max(400, targetElo - 200);
  const rangeMax = Math.min(3200, targetElo + 200);
  const inRange = EXPLORER_RATING_BUCKETS.filter((bucket) => bucket >= rangeMin && bucket <= rangeMax);

  if (inRange.length > 0) {
    return inRange.join(",");
  }

  const closestBucket = EXPLORER_RATING_BUCKETS.reduce((closest, candidate) => {
    const closestDistance = Math.abs(closest - targetElo);
    const candidateDistance = Math.abs(candidate - targetElo);
    return candidateDistance < closestDistance ? candidate : closest;
  });

  return String(closestBucket);
}

function getLastMoveSquaresByColor(
  currentGame: Chess,
  color: PlayerColor,
): { from: Square; to: Square } | null {
  const history = currentGame.history({ verbose: true }) as Move[];

  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].color === color) {
      return {
        from: history[index].from as Square,
        to: history[index].to as Square,
      };
    }
  }

  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function App() {
  const [eloInput, setEloInput] = useState("1500");
  const [botMoveThresholdInput, setBotMoveThresholdInput] = useState("10");
  const [alwaysPlayMostCommonMove, setAlwaysPlayMostCommonMove] = useState(false);
  const [selectedOpeningId, setSelectedOpeningId] = useState(OPENINGS[0].id);
  const [openingSearch, setOpeningSearch] = useState("");
  const [openingDropdownOpen, setOpeningDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedSpeed: SpeedOption = "rapid";

  const [game, setGame] = useState(() => new Chess());
  const [moveHistoryUci, setMoveHistoryUci] = useState<string[]>([]);
  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [status, setStatus] = useState("");
  const [lastBotMove, setLastBotMove] = useState<string>("");
  const [lastBotMoveRate, setLastBotMoveRate] = useState<number | null>(null);
  const [lastMoveReview, setLastMoveReview] = useState<MoveReview | null>(null);
  const [hintMove, setHintMove] = useState<RankedMove | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [brilliantToSquare, setBrilliantToSquare] = useState<Square | null>(null);
  const [positionGames2000Plus, setPositionGames2000Plus] = useState<number | null>(null);
  const [positionGamesLoading, setPositionGamesLoading] = useState(false);
  const [moveCounter, setMoveCounter] = useState(0);
  const [accuracyTracker, setAccuracyTracker] = useState({
    sum: 0,
    count: 0,
    display: 100,
  });

  const sessionIdRef = useRef(0);
  const brilliantHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingSearchResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedOpening = OPENINGS.find((opening) => opening.id === selectedOpeningId) ?? OPENINGS[0];
  const filteredOpenings = OPENINGS.filter((opening) =>
    `${opening.name} ${opening.description}`.toLowerCase().includes(openingSearch.trim().toLowerCase()),
  );
  const activeUserColor = sessionConfig?.opening.userColor ?? selectedOpening.userColor;
  const boardOrientation = activeUserColor === "w" ? "white" : "black";
  const practiceStarted = sessionConfig !== null;
  const safeElo = clampElo(eloInput);
  const safeBotMoveThresholdPercent = clampPercent(botMoveThresholdInput, 10);
  const activeBotColor = opponentColor(activeUserColor);
  const hintFromSquare = hintMove ? hintMove.uci.slice(0, 2) : null;
  const hintToSquare = hintMove ? hintMove.uci.slice(2, 4) : null;
  const lastBotMoveSquares = getLastMoveSquaresByColor(game, activeBotColor);
  const botMoveSquareStyles: Record<string, CSSProperties> = lastBotMoveSquares
    ? {
        [lastBotMoveSquares.from]: {
          backgroundColor: "rgba(37, 99, 235, 0.25)",
        },
        [lastBotMoveSquares.to]: {
          backgroundColor: "rgba(37, 99, 235, 0.45)",
        },
      }
    : {};
  const hintSquareStyles: Record<string, CSSProperties> =
    hintFromSquare && hintToSquare
      ? {
          [hintFromSquare]: {
            backgroundColor: "rgba(15, 118, 110, 0.38)",
          },
          [hintToSquare]: {
            backgroundColor: "rgba(245, 158, 11, 0.4)",
          },
        }
      : {};
  const brilliantSquareStyles: Record<string, CSSProperties> = brilliantToSquare
    ? {
        [brilliantToSquare]: {
          backgroundColor: "rgba(34, 197, 94, 0)",
          animation: "brilliantSquareFlash 1s cubic-bezier(0.22, 0.61, 0.36, 1)",
          animationFillMode: "forwards",
        },
      }
    : {};
  const combinedSquareStyles: Record<string, CSSProperties> = {
    ...botMoveSquareStyles,
    ...hintSquareStyles,
    ...brilliantSquareStyles,
  };

  const clearBrilliantHighlight = (): void => {
    if (brilliantHighlightTimeoutRef.current) {
      clearTimeout(brilliantHighlightTimeoutRef.current);
      brilliantHighlightTimeoutRef.current = null;
    }

    setBrilliantToSquare(null);
  };

  const flashBrilliantSquare = (square: Square): void => {
    if (brilliantHighlightTimeoutRef.current) {
      clearTimeout(brilliantHighlightTimeoutRef.current);
    }

    setBrilliantToSquare(square);
    brilliantHighlightTimeoutRef.current = setTimeout(() => {
      setBrilliantToSquare(null);
      brilliantHighlightTimeoutRef.current = null;
    }, BRILLIANT_FLASH_MS);
  };

  const clearOpeningSearchResetTimer = (): void => {
    if (openingSearchResetTimeoutRef.current) {
      clearTimeout(openingSearchResetTimeoutRef.current);
      openingSearchResetTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    if (!sessionConfig) {
      setPositionGames2000Plus(null);
      setPositionGamesLoading(false);
      return;
    }

    const sessionId = sessionIdRef.current;
    let cancelled = false;
    setPositionGamesLoading(true);

    void fetchExplorerMoves(moveHistoryUci, HIGH_ELO_RATINGS, sessionConfig.speed)
      .then((explorer) => {
        if (cancelled || sessionId !== sessionIdRef.current) {
          return;
        }

        setPositionGames2000Plus(getExplorerTotalGames(explorer));
      })
      .catch(() => {
        if (cancelled || sessionId !== sessionIdRef.current) {
          return;
        }

        setPositionGames2000Plus(null);
      })
      .finally(() => {
        if (cancelled || sessionId !== sessionIdRef.current) {
          return;
        }

        setPositionGamesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [moveHistoryUci, sessionConfig]);

  useEffect(() => {
    clearOpeningSearchResetTimer();

    if (openingDropdownOpen || openingSearch.trim().length === 0) {
      return;
    }

    openingSearchResetTimeoutRef.current = setTimeout(() => {
      setOpeningSearch("");
      openingSearchResetTimeoutRef.current = null;
    }, OPENING_SEARCH_RESET_MS);

    return clearOpeningSearchResetTimer;
  }, [openingDropdownOpen, openingSearch]);

  useEffect(() => {
    return () => {
      if (brilliantHighlightTimeoutRef.current) {
        clearTimeout(brilliantHighlightTimeoutRef.current);
      }

      clearOpeningSearchResetTimer();
    };
  }, []);

  const clearSessionState = (nextStatus: string): void => {
    sessionIdRef.current += 1;
    setSessionConfig(null);
    setGame(new Chess());
    setMoveHistoryUci([]);
    setBotThinking(false);
    setIsSeeding(false);
    setLastBotMove("");
    setLastBotMoveRate(null);
    setLastMoveReview(null);
    setHintMove(null);
    setHintLoading(false);
    clearBrilliantHighlight();
    setPositionGames2000Plus(null);
    setPositionGamesLoading(false);
    setOpeningDropdownOpen(false);
    setMoveCounter(0);
    setAccuracyTracker({
      sum: 0,
      count: 0,
      display: 100,
    });
    setStatus(nextStatus);
  };

  const recordAccuracySample = (totalGames: number): void => {
    const sample = accuracyFromGames(totalGames);
    setAccuracyTracker((previous) => {
      const sum = previous.sum + sample;
      const count = previous.count + 1;
      const average = sum / count;
      return {
        sum,
        count,
        display: Math.min(previous.display, average),
      };
    });
  };

  const playBotMove = async (
    currentGame: Chess,
    currentHistory: string[],
    config: SessionConfig,
    sessionId: number,
  ): Promise<void> => {
    setBotThinking(true);
    setStatus("Bot is choosing a move...");

    try {
      const explorer = await fetchExplorerMoves(currentHistory, config.eloRatings, config.speed);

      if (sessionId !== sessionIdRef.current) {
        return;
      }

      recordAccuracySample(getExplorerTotalGames(explorer));
      const totalGamesAtPosition = getExplorerTotalGames(explorer);

      const { selected, selectedRate, usedFallbackPool } = chooseWeightedMove(
        explorer,
        config.botMoveThresholdPercent,
        config.alwaysPlayMostCommonMove,
      );

      if (!selected) {
        setStatus(
          "No playable move returned for this position at current filters. Try a different opening or Elo.",
        );
        return;
      }

      const selectedUci = normalizeCastlingUci(selected.uci);
      const nextGame = new Chess(currentGame.fen());
      const appliedMove = nextGame.move(parseUci(selectedUci));

      if (!appliedMove) {
        setStatus(`Explorer suggested illegal move ${selected.uci}. Try another position.`);
        return;
      }

      const nextHistory = [...currentHistory, selectedUci];
      setGame(nextGame);
      setMoveHistoryUci(nextHistory);
      setLastBotMove(appliedMove.san);
      setLastBotMoveRate(selectedRate);
      setHintMove(null);
      const botColor = colorLabel(opponentColor(config.opening.userColor));
      const ratePct = (selectedRate * 100).toFixed(1);
      const moveRateMessage = `From ${totalGamesAtPosition.toLocaleString()} games in this position, ${botColor} plays ${appliedMove.san} ${ratePct}% of the time at your elo.`;

      if (nextGame.isGameOver()) {
        setStatus(`${moveRateMessage} ${describeGameOver(nextGame)}`);
        return;
      }

      if (usedFallbackPool) {
        setStatus(
          `${moveRateMessage} No move was above ${formatPercentValue(
            config.botMoveThresholdPercent,
          )}%, so it used the full move list for this turn.`,
        );
        return;
      }

      setStatus(`${moveRateMessage} Your move.`);
    } catch (error) {
      if (sessionId !== sessionIdRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown error.";
      setStatus(`Explorer request failed: ${message}`);
    } finally {
      if (sessionId === sessionIdRef.current) {
        setBotThinking(false);
      }
    }
  };

  const scoreUserMove = async (
    beforeMoveHistory: string[],
    nextGame: Chess,
    nextHistory: string[],
    userMove: Move,
    config: SessionConfig,
    sessionId: number,
  ): Promise<void> => {
    setStatus("Scoring your move using 2000+ games...");

    try {
      const explorer = await fetchExplorerMoves(beforeMoveHistory, HIGH_ELO_RATINGS, config.speed);

      if (sessionId !== sessionIdRef.current) {
        return;
      }

      recordAccuracySample(getExplorerTotalGames(explorer));

      const rankedMoves = buildRankedMoves(explorer);
      const review = buildMoveReview(rankedMoves, userMove, config.opening.userColor);
      setLastMoveReview(review);
      if (review.grade === "!!") {
        flashBrilliantSquare(userMove.to as Square);
      } else {
        clearBrilliantHighlight();
      }

      const rankText = review.playedRank ? `#${review.playedRank}` : "unranked";
      setStatus(`You played ${review.playedSan}: ${review.grade} (rank ${rankText} in 2000+ games).`);
    } catch (error) {
      if (sessionId !== sessionIdRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown error.";
      setStatus(`Could not score this move from 2000+ data: ${message}`);
    }

    if (sessionId !== sessionIdRef.current) {
      return;
    }

    if (nextGame.isGameOver()) {
      setStatus(`You played ${userMove.san}. ${describeGameOver(nextGame)}`);
      return;
    }

    await delay(BOT_MOVE_DELAY_MS);

    if (sessionId !== sessionIdRef.current) {
      return;
    }

    await playBotMove(nextGame, nextHistory, config, sessionId);
  };

  const requestHint = async (): Promise<void> => {
    if (!sessionConfig) {
      setStatus("Start a session first to use hints.");
      return;
    }

    if (isSeeding) {
      setStatus("Wait for opening setup to finish before requesting a hint.");
      return;
    }

    if (game.isGameOver()) {
      setStatus("This game is over. Restart to use hints again.");
      return;
    }

    if (game.turn() !== sessionConfig.opening.userColor) {
      setStatus("Hint is only available on your turn.");
      return;
    }

    const sessionId = sessionIdRef.current;
    setHintLoading(true);
    setStatus("Loading hint from 2000+ games...");

    try {
      const explorer = await fetchExplorerMoves(moveHistoryUci, HIGH_ELO_RATINGS, sessionConfig.speed);

      if (sessionId !== sessionIdRef.current) {
        return;
      }

      const rankedMoves = buildRankedMoves(explorer);
      const bestMove = rankedMoves[0];

      if (!bestMove) {
        setHintMove(null);
        setStatus("No hint available for this position.");
        return;
      }

      setHintMove(bestMove);
      setStatus(
        `Hint: most played move for ${colorLabel(sessionConfig.opening.userColor)} is ${bestMove.san} (${formatRate(bestMove.rate)} in 2000+ games).`,
      );
    } catch (error) {
      if (sessionId !== sessionIdRef.current) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown error.";
      setStatus(`Could not load hint: ${message}`);
    } finally {
      if (sessionId === sessionIdRef.current) {
        setHintLoading(false);
      }
    }
  };

  const startPractice = async (): Promise<void> => {
    const config: SessionConfig = {
      opening: selectedOpening,
      elo: safeElo,
      eloRatings: buildRatingsFilterFromTargetElo(safeElo),
      speed: selectedSpeed,
      botMoveThresholdPercent: safeBotMoveThresholdPercent,
      alwaysPlayMostCommonMove,
    };

    sessionIdRef.current += 1;
    const sessionId = sessionIdRef.current;

    setSessionConfig(config);
    setGame(new Chess());
    setMoveHistoryUci([]);
    setBotThinking(false);
    setIsSeeding(true);
    setLastBotMove("");
    setLastBotMoveRate(null);
    setLastMoveReview(null);
    setHintMove(null);
    setHintLoading(false);
    clearBrilliantHighlight();
    setPositionGames2000Plus(null);
    setPositionGamesLoading(false);
    setOpeningDropdownOpen(false);
    setMoveCounter(0);
    setAccuracyTracker({
      sum: 0,
      count: 0,
      display: 100,
    });

    const seededGame = new Chess();
    const seededHistory: string[] = [];

    try {
      const totalSeedMoves = config.opening.seedMoves.length;
      setStatus("Setting up opening line...");

      for (let index = 0; index < totalSeedMoves; index += 1) {
        if (sessionId !== sessionIdRef.current) {
          return;
        }

        const uci = config.opening.seedMoves[index];
        const move = seededGame.move(parseUci(uci));
        if (!move) {
          setStatus(`Invalid seed move in opening preset: ${uci}`);
          return;
        }

        seededHistory.push(uci);
        setGame(new Chess(seededGame.fen()));
        setMoveHistoryUci([...seededHistory]);
        setStatus(`Setting up opening line... ${index + 1}/${totalSeedMoves} (${move.san})`);

        if (index < totalSeedMoves - 1) {
          await delay(500);
        }
      }
    } finally {
      if (sessionId === sessionIdRef.current) {
        setIsSeeding(false);
      }
    }

    if (sessionId !== sessionIdRef.current) {
      return;
    }

    if (seededGame.isGameOver()) {
      setStatus(`Practice started. ${describeGameOver(seededGame)}`);
      return;
    }

    if (seededGame.turn() === config.opening.userColor) {
      setStatus("Practice started. Your move.");
      return;
    }

    setStatus("Practice started. Bot will move in 1.1 seconds...");
    await delay(BOT_MOVE_DELAY_MS);

    if (sessionId !== sessionIdRef.current) {
      return;
    }

    await playBotMove(seededGame, seededHistory, config, sessionId);
  };

  const resetSession = (): void => {
    const hadSession = Boolean(sessionConfig) || moveHistoryUci.length > 0;
    clearSessionState(hadSession ? "Session ended." : "");
  };

  const undoLastAttempt = (): void => {
    if (!sessionConfig) {
      return;
    }

    const seedLength = sessionConfig.opening.seedMoves.length;
    if (moveHistoryUci.length <= seedLength) {
      setStatus("Nothing to undo yet.");
      return;
    }

    // Cancel any in-flight async updates before rewriting board state.
    sessionIdRef.current += 1;

    const nextGame = new Chess();
    for (const uci of moveHistoryUci) {
      const reconstructed = nextGame.move(parseUci(uci));
      if (!reconstructed) {
        setStatus("Could not reconstruct game history for undo.");
        return;
      }
    }

    const nextHistory = [...moveHistoryUci];
    let undoneCount = 0;
    let undoneUserMoves = 0;

    while (nextHistory.length > seedLength) {
      const undoneMove = nextGame.undo();
      if (!undoneMove) {
        break;
      }

      nextHistory.pop();
      undoneCount += 1;
      if (undoneMove.color === sessionConfig.opening.userColor) {
        undoneUserMoves += 1;
      }

      if (nextGame.turn() === sessionConfig.opening.userColor) {
        break;
      }
    }

    if (undoneCount === 0) {
      setStatus("Could not undo the last move.");
      return;
    }

    setGame(nextGame);
    setMoveHistoryUci(nextHistory);
    setBotThinking(false);
    setIsSeeding(false);
    setHintLoading(false);
    setHintMove(null);
    clearBrilliantHighlight();
    setLastBotMoveRate(null);
    setMoveCounter((previous) => Math.max(0, previous - undoneUserMoves));
    setLastMoveReview(null);
    setLastBotMove(getLastBotMoveSan(nextGame, opponentColor(sessionConfig.opening.userColor)));

    setStatus("Undid the last move. Try again.");
  };

  const onPieceDrop = ({ piece, sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (!sessionConfig) {
      return false;
    }

    if (!targetSquare) {
      return false;
    }

    if (isSeeding || botThinking || game.isGameOver() || game.turn() !== sessionConfig.opening.userColor) {
      return false;
    }

    const nextGame = new Chess(game.fen());
    const isPromotion =
      piece.pieceType.toLowerCase().endsWith("p") &&
      (targetSquare.toLowerCase().endsWith("1") || targetSquare.toLowerCase().endsWith("8"));

    const move = nextGame.move({
      from: sourceSquare as Square,
      to: targetSquare as Square,
      promotion: isPromotion ? "q" : undefined,
    });

    if (!move) {
      return false;
    }

    const nextHistory = [...moveHistoryUci, toUci(move)];
    const beforeMoveHistory = [...moveHistoryUci];
    setGame(nextGame);
    setMoveHistoryUci(nextHistory);
    setHintMove(null);
    clearBrilliantHighlight();
    setMoveCounter((previous) => previous + 1);

    void scoreUserMove(
      beforeMoveHistory,
      nextGame,
      nextHistory,
      move,
      sessionConfig,
      sessionIdRef.current,
    );
    return true;
  };

  const controlsDisabled = isSeeding || botThinking || hintLoading;
  const canRequestHint =
    Boolean(sessionConfig) &&
    !isSeeding &&
    !botThinking &&
    !hintLoading &&
    !game.isGameOver() &&
    game.turn() === activeUserColor;
  const canUndo =
    Boolean(sessionConfig) &&
    !isSeeding &&
    !botThinking &&
    !hintLoading &&
    moveHistoryUci.length > (sessionConfig?.opening.seedMoves.length ?? 0);
  const canReset = Boolean(sessionConfig) || moveHistoryUci.length > 0;
  const isGameRunning = Boolean(sessionConfig) && !game.isGameOver();
  const reviewGradeClass =
    lastMoveReview?.grade === "!!"
      ? "grade-brilliant"
      : lastMoveReview?.grade === "✓"
        ? "grade-alternative"
        : "grade-miss";
  const topFiveMoves = lastMoveReview?.rankedMoves.slice(0, 5) ?? [];
  const topFiveMoveRows = Array.from({ length: 5 }, (_, index) => topFiveMoves[index] ?? null);
  const positionAccuracyPercent =
    positionGames2000Plus === null ? 100 : accuracyFromGames(positionGames2000Plus);
  const positionAccuracyLabel = formatPositionAccuracyLabel(
    positionGames2000Plus,
    positionAccuracyPercent,
  );
  const positionAccuracyBarPercent = Math.min(100, Math.max(1, positionAccuracyPercent));
  const positionAccuracyHue = (positionAccuracyBarPercent / 100) * 120;
  const positionAccuracyBarStyle: CSSProperties = {
    width: `${positionAccuracyBarPercent}%`,
    backgroundColor: `hsl(${positionAccuracyHue} 78% 42%)`,
  };
  const positionAccuracyGamesLabel =
    positionGamesLoading && positionGames2000Plus === null
      ? "Loading sample..."
      : positionGames2000Plus !== null
        ? `${positionGames2000Plus.toLocaleString()} games`
        : "Awaiting position sample";

  return (
    <main
      className="app-shell compact-shell"
      data-moves={moveCounter}
      data-accuracy={accuracyTracker.display.toFixed(1)}
    >
      <header className="top-bar">
        <h1>ChessOpening.lol</h1>
        <button
          type="button"
          className="icon-control gear-control"
          onClick={() => setSettingsOpen((previous) => !previous)}
          aria-label="Toggle settings"
        >
          {settingsOpen ? (
            <svg className="icon-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="icon-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3L14 4L16.5 3.5L17.5 5.5L20 7L19.5 9.5L21 12L19.5 14.5L20 17L17.5 18.5L16.5 20.5L14 20L12 21L10 20L7.5 20.5L6.5 18.5L4 17L4.5 14.5L3 12L4.5 9.5L4 7L6.5 5.5L7.5 3.5L10 4L12 3Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </button>
      </header>

      {settingsOpen ? (
        <section className="settings-drawer">
          <div className="settings-grid">
            <label className="field">
              <span>Elo</span>
              <input
                type="number"
                min={400}
                max={3200}
                step={50}
                value={eloInput}
                onChange={(event) => setEloInput(event.target.value)}
                onBlur={() => setEloInput(String(safeElo))}
                disabled={controlsDisabled}
              />
            </label>

            <label className="field">
              <span>Common Move Threshold (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={botMoveThresholdInput}
                onChange={(event) => setBotMoveThresholdInput(event.target.value)}
                onBlur={() => setBotMoveThresholdInput(String(safeBotMoveThresholdPercent))}
                disabled={controlsDisabled}
              />
            </label>

            <label className="field field-wide checkbox-field">
              <input
                type="checkbox"
                checked={alwaysPlayMostCommonMove}
                onChange={(event) => setAlwaysPlayMostCommonMove(event.target.checked)}
                disabled={controlsDisabled}
              />
              <span>Always play most common move</span>
            </label>
          </div>
        </section>
      ) : null}

      <section className="play-area">
        <div className="opening-bar">
          <div className="opening-picker">
            <span className="opening-label">Opening</span>
            <button
              type="button"
              className={`opening-trigger ${openingDropdownOpen ? "opening-trigger-open" : ""}`}
              onClick={() => setOpeningDropdownOpen((previous) => !previous)}
              disabled={controlsDisabled}
              aria-expanded={openingDropdownOpen}
              aria-label="Select opening"
            >
              <span className="opening-trigger-header">
                <span className="opening-trigger-name">{selectedOpening.name}</span>
                <span className="opening-trigger-arrow" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M6 9L12 15L18 9"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </span>
              <span className="opening-trigger-line">{selectedOpening.description}</span>
            </button>

            {openingDropdownOpen ? (
              <div className="opening-dropdown">
                <input
                  type="search"
                  className="opening-search"
                  value={openingSearch}
                  onChange={(event) => setOpeningSearch(event.target.value)}
                  placeholder="Search openings"
                  disabled={controlsDisabled}
                />
                <div className="opening-options" role="listbox" aria-label="Opening options">
                  {filteredOpenings.length > 0 ? (
                    filteredOpenings.map((opening) => (
                      <button
                        key={opening.id}
                        type="button"
                        className={`opening-option ${selectedOpeningId === opening.id ? "opening-option-selected" : ""}`}
                        onClick={() => {
                          const openingChanged = opening.id !== selectedOpeningId;
                          setSelectedOpeningId(opening.id);
                          setOpeningDropdownOpen(false);
                          if (openingChanged && isGameRunning) {
                            clearSessionState("");
                          }
                        }}
                        disabled={controlsDisabled}
                      >
                        <span className="opening-option-name">{opening.name}</span>
                        <span className="opening-option-line">{opening.description}</span>
                      </button>
                    ))
                  ) : (
                    <p className="opening-empty">No openings found.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="board-card">
          <div className="board-frame">
            <Chessboard
              options={{
                id: "opening-trainer-board",
                position: game.fen(),
                boardOrientation,
                onPieceDrop,
                boardStyle: {
                  width: "100%",
                  height: "100%",
                },
                arrows:
                  hintFromSquare && hintToSquare
                    ? [{ startSquare: hintFromSquare, endSquare: hintToSquare, color: "#0f766e" }]
                    : [],
                squareStyles: combinedSquareStyles,
                allowDragging:
                  practiceStarted &&
                  !isSeeding &&
                  !botThinking &&
                  !game.isGameOver() &&
                  game.turn() === activeUserColor,
              }}
            />
          </div>
        </div>

        <div className="under-board-card">
          <div className="action-buttons">
            <button
              type="button"
              className="icon-control"
              onClick={requestHint}
              disabled={!canRequestHint}
              aria-label="Hint"
              title="Hint"
            >
              <svg className="icon-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M9 18H15M10 22H14M8 14C6.7 12.9 6 11.3 6 9.5C6 6.5 8.5 4 12 4C15.5 4 18 6.5 18 9.5C18 11.3 17.3 12.9 16 14C15.2 14.7 14.7 15.7 14.7 16.8V17H9.3V16.8C9.3 15.7 8.8 14.7 8 14Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className={`icon-control ${lastMoveReview && lastMoveReview.playedRate < 0.04 ? "undo-highlight" : ""}`}
              onClick={undoLastAttempt}
              disabled={!canUndo}
              aria-label="Undo"
              title="Undo"
            >
              <svg className="icon-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M9 7L4 12L9 17M4 12H14C17.3 12 20 14.7 20 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="resume-control"
              onClick={resetSession}
              disabled={!canReset}
              aria-label="End"
              title="End"
            >
              End
            </button>
            <button
              type="button"
              className="resume-control"
              onClick={() => void startPractice()}
              disabled={controlsDisabled || isGameRunning}
            >
              Start
            </button>
          </div>

          <div className="review-panel">
            <span className="review-title">Move review</span>
            <span className={`review-grade ${reviewGradeClass}`}>{lastMoveReview?.grade ?? "-"}</span>
            <ol className="top-moves-list">
              {topFiveMoveRows.map((entry, index) =>
                entry ? (
                  <li
                    key={entry.uci}
                    className={lastMoveReview?.playedRank === entry.rank ? "top-move-played" : undefined}
                  >
                    {entry.san} ({formatRate(entry.rate)})
                  </li>
                ) : (
                  <li key={`placeholder-${index}`} className="top-move-placeholder">
                    -
                  </li>
                ),
              )}
            </ol>
          </div>

          <div className="bot-side-panel">
            <span className="bot-line-title">Bots move</span>
            <strong className="bot-line-move">{lastBotMove || "-"}</strong>
            <span className="bot-line-rate">
              {lastBotMoveRate !== null
                ? `Plays ${(lastBotMoveRate * 100).toFixed(1)}% at your elo`
                : status || "Play to begin"}
            </span>
            <div className="position-accuracy">
              <div className="position-accuracy-header">
                <span className="position-accuracy-title">Position accuracy</span>
                <strong className="position-accuracy-value">{positionAccuracyLabel}</strong>
              </div>
              <div className="position-accuracy-bar" aria-hidden="true">
                <div className="position-accuracy-fill" style={positionAccuracyBarStyle} />
              </div>
              <span className="position-accuracy-sample">{positionAccuracyGamesLabel}</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;

import TimeControlType from '../../shared/time-control/TimeControlType';
import { BOARD_DEFAULT_SIZE, PlayerIndex } from '../game-engine';

const { min, max, floor } = Math;

export type GameOptionsOpponentPlayerData = {
    type: 'player';
};

export type GameOptionsOpponentAIData = {
    type: 'ai';
};

export type GameOptionsOpponentLocalAIData = {
    type: 'local_ai';
};

export type GameOptionsData = {
    /**
     * Defaults to Board.
     */
    boardsize: number;

    /**
     * Who plays first.
     * null: random (default)
     * 0: Host begins
     * 1: Opponent or bot begins
     */
    firstPlayer: null | PlayerIndex;

    /**
     * Whether the swap rule is enabled or not.
     * Should be true by default for 1v1 games.
     */
    swapRule: boolean;

    /**
     * Which opponent I want. Can be:
     *  - type: player, with elo restriction, or a friend...
     *  - type: ai, with a engine, level...
     *  - type: local_ai, play offline vs AI
     */
    opponent: GameOptionsOpponentPlayerData
        | GameOptionsOpponentAIData
        | GameOptionsOpponentLocalAIData
    ;

    timeControl: TimeControlType;
};

export const defaultGameOptions: GameOptionsData = {
    boardsize: 11,
    firstPlayer: null,
    swapRule: true,
    opponent: { type: 'player' },
    timeControl: {
        type: 'absolute',
        options: {
            secondsPerPlayer: 900,
        },
    },
};

const DEFAULT_BOARDSIZE = BOARD_DEFAULT_SIZE;
const MIN_BOARDSIZE = 1;
const MAX_BOARDSIZE = 42;

const sanitizeBoardsize = (boardsize: unknown): number => {
    if (!boardsize) {
        return DEFAULT_BOARDSIZE;
    }

    const sanitized = floor(min(max(+boardsize, MIN_BOARDSIZE), MAX_BOARDSIZE));

    return Number.isInteger(sanitized)
        ? sanitized
        : DEFAULT_BOARDSIZE
    ;
};

const sanitizeFirstPlayer = (firstPlayer: unknown): null | PlayerIndex => {
    if (0 === firstPlayer || '0' === firstPlayer) {
        return 0;
    }

    if (1 === firstPlayer || '1' === firstPlayer) {
        return 1;
    }

    return null;
};

export const sanitizeGameOptions = (gameOptions: GameOptionsData): GameOptionsData => {
    return {
        boardsize: sanitizeBoardsize(gameOptions.boardsize ?? DEFAULT_BOARDSIZE),
        firstPlayer: sanitizeFirstPlayer(gameOptions.firstPlayer),
        swapRule: !!gameOptions.swapRule,
        opponent: gameOptions.opponent,
        timeControl: gameOptions.timeControl,
    };
};


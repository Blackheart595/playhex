<script setup lang="ts">
/* eslint-env browser */
import 'bootstrap/js/dist/dropdown';
import useLobbyStore from '@client/stores/lobbyStore';
import { ref, computed } from 'vue';
import AppBoard from '@client/vue/components/AppBoard.vue';
import ConfirmationOverlay from '@client/vue/components/overlay/ConfirmationOverlay.vue';
import HostedGameClient, { listenGameUpdates } from '../../HostedGameClient';
import { defineOverlay } from '@overlastic/vue';
import { Ref, onUnmounted, watch, watchEffect } from 'vue';
import useSocketStore from '@client/stores/socketStore';
import useAuthStore from '@client/stores/authStore';
import Rooms from '@shared/app/Rooms';
import { timeControlToCadencyName } from '../../../shared/app/timeControlUtils';
import { useRoute, useRouter } from 'vue-router';
import { BIconFlag, BIconXLg, BIconCheck, BIconArrowBarLeft, BIconRepeat, BIconArrowCounterclockwise, BIconX, BIconRewind, BIconList, BIconArrowDownUp } from 'bootstrap-icons-vue';
import usePlayerSettingsStore from '../../stores/playerSettingsStore';
import usePlayerLocalSettingsStore from '../../stores/playerLocalSettingsStore';
import { storeToRefs } from 'pinia';
import i18next from 'i18next';
import { Move, PlayerIndex } from '@shared/game-engine';
import { useSeoMeta } from '@unhead/vue';
import AppGameSidebar from '../components/AppGameSidebar.vue';
import AppConnectionAlert from '../components/AppConnectionAlert.vue';
import { HostedGame } from '../../../shared/app/models';
import { fromEngineMove } from '../../../shared/app/models/Move';
import { pseudoString } from '../../../shared/app/pseudoUtils';
import { CustomizedGameView } from '../../services/CustomizedGameView';
import { isMyTurn } from '../../services/notifications/context-utils';
import { canPassAgain } from '../../../shared/app/passUtils';
import AppHexWorldExplore from '../components/AppHexWorldExplore.vue';
import { apiPostRematch } from '../../apiClient';
import { canJoin } from '../../../shared/app/hostedGameUtils';
import { Socket } from 'socket.io-client';
import { HexClientToServerEvents, HexServerToClientEvents } from '../../../shared/app/HexSocketEvents';

useSeoMeta({
    robots: 'noindex',
});

const { gameId } = useRoute().params;

const hostedGameClient: Ref<HostedGameClient | null> = ref(null);

let gameView: null | CustomizedGameView = null; // Cannot be a ref() because crash when toggle coords and hover board. Also, using .mount() on a ref is very laggy.

/**
 * When game is loaded, gameView instanciated
 */
const gameViewInitialized = ref(false);

if (Array.isArray(gameId)) {
    throw new Error('unexpected array param in gameId');
}

const socketStore = useSocketStore();
const lobbyStore = useLobbyStore();
const { loggedInPlayer } = storeToRefs(useAuthStore());
const router = useRouter();

/*
 * Confirm move
 */
const { playerSettings } = storeToRefs(usePlayerSettingsStore());
const { localSettings } = usePlayerLocalSettingsStore();
const confirmMove: Ref<null | (() => void)> = ref(null);

const shouldDisplayConfirmMove = (): boolean => {
    if (null === hostedGameClient.value || null === playerSettings.value) {
        return false;
    }

    // I am watcher
    if (-1 === getLocalPlayerIndex()) {
        return false;
    }

    // Game has ended. Still display button when game is not yet started to make sure it works
    if ('ended' === hostedGameClient.value.getState()) {
        return false;
    }

    return {
        blitz: playerSettings.value.confirmMoveBlitz,
        normal: playerSettings.value.confirmMoveNormal,
        correspondence: playerSettings.value.confirmMoveCorrespondence,
    }[timeControlToCadencyName(hostedGameClient.value.getHostedGame().gameOptions)];
};

/*
 * Undo move
 */
const shouldDisplayUndoMove = (): boolean => {
    if (null === hostedGameClient.value || null === playerSettings.value) {
        return false;
    }

    // I am watcher
    if (-1 === getLocalPlayerIndex()) {
        return false;
    }

    if ('playing' !== hostedGameClient.value.getState()) {
        return false;
    }

    // Show a disabled button if I sent an undo request,
    // but hide it if opponent sent an undo request.
    if (hostedGameClient.value?.getUndoRequest() === 1 - getLocalPlayerIndex()) {
        return false;
    }

    return true;
};

const shouldDisableUndoMove = (): boolean => {
    if (!hostedGameClient.value) {
        return true;
    }

    const game = hostedGameClient.value.getGame();

    return hostedGameClient.value.getUndoRequest() === getLocalPlayerIndex()
        || true !== game.canPlayerUndo(getLocalPlayerIndex() as PlayerIndex)
    ;
};

const shouldDisplayAnswerUndoMove = (): boolean => {
    if (!hostedGameClient.value) {
        return false;
    }

    if ('playing' !== hostedGameClient.value.getState()) {
        return false;
    }

    return hostedGameClient.value?.getUndoRequest() === 1 - getLocalPlayerIndex();
};

const askUndo = (): void => {
    hostedGameClient.value?.sendAskUndo();
};

const answerUndo = (accept: boolean): void => {
    hostedGameClient.value?.sendAnswerUndo(accept);
};

const getLocalPlayerIndex = (): number => {
    if (null === loggedInPlayer.value || !hostedGameClient.value) {
        return -1;
    }

    return hostedGameClient.value.getPlayerIndex(loggedInPlayer.value);
};

const listenHexClick = () => {
    if (null === gameView) {
        throw new Error('no game view');
    }

    gameView.on('hexClicked', coords => {
        if (null === hostedGameClient.value) {
            throw new Error('hex clicked but hosted game is null');
        }

        const game = hostedGameClient.value.getGame();
        const move = game.createMoveOrSwapMove(coords);

        try {
            // Must get local player again in case player joined after (click "Watch", then "Join")
            const localPlayerIndex = getLocalPlayerIndex();

            if (-1 === localPlayerIndex) {
                return;
            }

            hostedGameClient.value.getGame().checkMove(move, localPlayerIndex as PlayerIndex);

            // Send move if move preview is not enabled
            if (!shouldDisplayConfirmMove()) {
                game.move(move, localPlayerIndex as PlayerIndex);
                hostedGameClient.value.sendMove(fromEngineMove(move));
                return;
            }

            // Cancel move preview if I click on it
            const previewedMove = gameView?.getPreviewedMove();

            if (previewedMove && previewedMove.move.sameAs(move)) {
                gameView?.removePreviewedMove();
                confirmMove.value = null;
                return;
            }

            // What happens when I validate move
            confirmMove.value = () => {
                game.move(move, localPlayerIndex as PlayerIndex);
                confirmMove.value = null;

                if (!hostedGameClient.value) {
                    return;
                }

                hostedGameClient.value.sendMove(fromEngineMove(move));
            };

            gameView?.setPreviewedMove(move, localPlayerIndex as PlayerIndex);
        } catch (e) {
            // noop
        }
    });
};

const initGameView = async () => {
    if (!hostedGameClient.value) {
        throw new Error('Cannot init game view now, no hostedGameClient');
    }

    const game = hostedGameClient.value.loadGame();

    gameView = new CustomizedGameView(game);

    gameViewInitialized.value = true;

    if (null !== playerSettings.value) {
        gameView.updateOptionsFromPlayerSettings(playerSettings.value);
    }

    await gameView.ready();

    // Should be after setDisplayCoords and setPreferredOrientations to start after redraws
    gameView.animateWinningPath();

    watch(playerSettings, settings => {
        if (null === gameView || null === settings) {
            return;
        }

        gameView.setDisplayCoords(settings.showCoords);
        gameView.setPreferredOrientations({
            landscape: settings.orientationLandscape,
            portrait: settings.orientationPortrait,
        });
    });

    if ('playing' === hostedGameClient.value.getState()) {
        listenHexClick();
    } else {
        hostedGameClient.value.on('started', () => listenHexClick());
    }
};

const makeTitle = (hostedGame: HostedGame) => {
    const players = hostedGame.hostedGameToPlayers.map(h => h.player);
    const { state } = hostedGame;
    const playerPseudos = players.map(p => pseudoString(p, 'pseudo'));
    if (players.length < 2 && 'created' === state)
        return `${i18next.t('game.title_waiting')} ${playerPseudos[0]}`;
    let yourTurn = '';
    if ('playing' === state && loggedInPlayer.value != null) {
        const player = loggedInPlayer.value;
        const index = players.findIndex(p => p.publicId === player.publicId);
        if (index != null && hostedGame.gameData?.currentPlayerIndex === index) {
            yourTurn = `• ${i18next.t('game.title_your_turn')} • `;
        }
    }
    const pairing = playerPseudos.join(' VS ');
    return `${yourTurn}${i18next.t('game_state.' + state)}: ${pairing}`;
};

/*
 * Load game
 */
let unlistenGameUpdates: null | (() => void) = null;

socketStore.socket.on('gameUpdate', async (publicId, hostedGame) => {
    // ignore if not my game, or already initialized
    if (publicId !== gameId || null !== hostedGameClient.value) {
        return;
    }

    // I received update but game seems not to exists.
    if (null === hostedGame) {
        router.push({ name: 'home' });
        return;
    }

    hostedGameClient.value = new HostedGameClient(hostedGame, socketStore.socket as Socket<HexServerToClientEvents, HexClientToServerEvents>);

    // I think `listenGameUpdates()` must be called synchronously here (i.e do not put await before this call)
    // to prevent losing updates between game initialization and next socket event.
    unlistenGameUpdates = listenGameUpdates(
        hostedGameClient as Ref<HostedGameClient>,
        socketStore.socket as Socket<HexServerToClientEvents, HexClientToServerEvents>,
    );

    await initGameView();

    const playerPseudos = hostedGameClient.value.getPlayers().map(p => p.pseudo);
    const { state, host } = hostedGameClient.value.getHostedGame();
    const description = 'created' === state
        ? `Hex game, hosted by ${host.pseudo}, waiting for an opponent.`
        : `Hex game, ${playerPseudos.join(' versus ')}.`
    ;

    useSeoMeta({
        robots: 'noindex',
        title: computed(() => {
            if (hostedGameClient.value == null) return '';
            return makeTitle(hostedGameClient.value.getHostedGame());
        }),
        description,
        ogDescription: description,
    });
});

/*
 * Join/leave game room.
 *
 * Must join after we set up the gameUpdate listener,
 * in order to initialize game properly.
 */
watchEffect(() => {
    if (socketStore.connected)
        socketStore.joinRoom(Rooms.game(gameId));
});

onUnmounted(() => {
    socketStore.leaveRoom(Rooms.game(gameId));

    if (null !== unlistenGameUpdates) {
        unlistenGameUpdates();
        unlistenGameUpdates = null;
    }
});

/*
 * Join game
 */
const join = () => {
    if (null === hostedGameClient.value) {
        return;
    }

    return lobbyStore.joinGame(hostedGameClient.value.getId());
};

const confirmationOverlay = defineOverlay(ConfirmationOverlay);

/*
 * Resign
 */
const canResign = (): boolean => {
    if (-1 === getLocalPlayerIndex() || null === hostedGameClient.value) {
        return false;
    }

    return hostedGameClient.value.canResign();
};

const resign = async (): Promise<void> => {
    const localPlayerIndex = getLocalPlayerIndex();

    if (-1 === localPlayerIndex) {
        return;
    }

    try {
        await confirmationOverlay({
            title: 'Resign game',
            message: 'Are you sure you want to resign the game?',
            confirmLabel: 'Yes, resign',
            confirmClass: 'btn-danger',
            cancelLabel: 'No, continue playing',
            cancelClass: 'btn-outline-primary',
        });

        hostedGameClient.value?.sendResign();
    } catch (e) {
        // resignation canceled
    }
};

/*
 * Cancel
 */
const canCancel = (): boolean => {
    if (-1 === getLocalPlayerIndex() || null === hostedGameClient.value) {
        return false;
    }

    return hostedGameClient.value.canCancel();
};

const cancel = async (): Promise<void> => {
    try {
        await confirmationOverlay({
            title: 'Cancel game',
            message: 'Are you sure you want to cancel the game?',
            confirmLabel: 'Yes, cancel',
            confirmClass: 'btn-warning',
            cancelLabel: 'No, keep the game',
            cancelClass: 'btn-outline-primary',
        });
    } catch (e) {
        // cancelation canceled
        return;
    }

    hostedGameClient.value?.sendCancel();
};

const toggleCoords = () => {
    if (null !== gameView) {
        gameView.toggleDisplayCoords();
    }
};

/*
 * Rematch
 */
const canAcceptRematch: Ref<boolean> = ref(false);

watchEffect(() => {
    if (hostedGameClient.value == null) return;
    const rematch = hostedGameClient.value.getRematch();
    if (rematch == null) return;
    if (loggedInPlayer.value == null) return;
    if (getLocalPlayerIndex() === -1) return;
    canAcceptRematch.value = canJoin(rematch, loggedInPlayer.value);
});

const canRematch = (): boolean => {
    if (-1 === getLocalPlayerIndex() || null === hostedGameClient.value) {
        return false;
    }
    return hostedGameClient.value.canRematch();
};

const createOrAcceptRematch = async (): Promise<void> => {
    if (!hostedGameClient.value) {
        throw new Error('Error while trying to rematch, no current game');
    }

    const rematchId = hostedGameClient.value.getRematchGameId();
    let hostedGameRematch: null | HostedGame = null;

    if (rematchId != null) {
        hostedGameRematch = await lobbyStore.getOrFetchHostedGame(rematchId);
        if (hostedGameRematch == null) {
            throw new Error('A rematch game does not exist');
        }
    } else {
        hostedGameRematch = await apiPostRematch(hostedGameClient.value.getId());
    }

    if (loggedInPlayer && canJoin(hostedGameRematch, loggedInPlayer.value)) {
        await lobbyStore.joinGame(hostedGameRematch.publicId);
    }

    router.push({
        name: 'online-game',
        params: {
            gameId: hostedGameRematch.publicId,
        },
    });
};

/*
 * Sidebar
 */
const showSidebar = (open = true): void => {
    localSettings.openSidebar = open;
};

const isSidebarCurrentlyOpen = (): boolean => {
    if (undefined !== localSettings.openSidebar) {
        return localSettings.openSidebar;
    }

    return window.screen.width >= 576;
};

/*
 * Chat
 */
watch(hostedGameClient, game => {
    if (null === game) {
        return;
    }

    game.on('chatMessagePosted', () => {
        if (isSidebarCurrentlyOpen()) {
            game.markAllMessagesRead();
        }
    });

    watch(localSettings, () => {
        if (isSidebarCurrentlyOpen()) {
            game.markAllMessagesRead();
        }
    });
});

const unreadMessages = (): number => {
    if (null === hostedGameClient.value) {
        return 0;
    }

    return hostedGameClient.value.getChatMessages().length
        - hostedGameClient.value.getReadMessages()
    ;
};

/*
 * Rewind mode
 */
const enableRewindMode = () => {
    gameView?.enableRewindMode();
};

/*
 * Pass
 */
const pass = async () => {
    if (null === hostedGameClient.value) {
        return;
    }

    const passMove = Move.pass();
    hostedGameClient.value.getGame().move(passMove, getLocalPlayerIndex() as PlayerIndex);
    hostedGameClient.value.sendMove(fromEngineMove(passMove));
};

const shouldShowPass = (): boolean => {
    if (null === hostedGameClient.value) {
        return false;
    }

    return 'playing' === hostedGameClient.value.getState()
        && -1 !== getLocalPlayerIndex()
    ;
};

const shouldEnablePass = (): boolean => {
    if (null === hostedGameClient.value) {
        return false;
    }

    return 'playing' === hostedGameClient.value.getState()
        && isMyTurn(hostedGameClient.value.getHostedGame())
        && canPassAgain(hostedGameClient.value.getGame())
    ;
};
</script>

<template>
    <div v-show="gameViewInitialized && null !== hostedGameClient" class="game-and-sidebar-container" :class="localSettings.openSidebar ? 'sidebar-open' : (undefined === localSettings.openSidebar ? 'sidebar-auto' : 'sidebar-closed')">
        <div class="game">

            <!-- Game board, "Accept" button -->
            <div class="board-container">
                <AppBoard
                    v-if="null !== hostedGameClient && null !== gameView"
                    :players="hostedGameClient.getPlayers()"
                    :timeControlOptions="hostedGameClient.getTimeControlOptions()"
                    :timeControlValues="hostedGameClient.getTimeControlValues()"
                    :gameView="gameView"
                />

                <div v-if="hostedGameClient && hostedGameClient.canJoin(loggedInPlayer)" class="join-button-container">
                    <div class="d-flex justify-content-center">
                        <button class="btn btn-lg btn-success" @click="join()">Accept</button>
                    </div>
                </div>
            </div>

            <!-- Control buttons at bottom of game board (resign, undo, confirm move, ...) -->
            <nav class="menu-game navbar" v-if="null !== hostedGameClient">
                <div class="buttons container-fluid">

                    <!-- rewind mode -->
                    <button type="button" v-if="null !== gameView" @click="() => enableRewindMode()" class="btn btn-outline-primary">
                        <BIconRewind />
                    </button>

                    <!-- Resign -->
                    <button type="button" class="btn btn-outline-danger" v-if="canResign() && !canCancel()" @click="resign()">
                        <BIconFlag />
                        <span class="hide-sm">{{ ' ' + $t('resign') }}</span>
                    </button>

                    <!-- Cancel -->
                    <button type="button" class="btn btn-outline-warning" v-if="canCancel()" @click="cancel()">
                        <BIconXLg />
                        <span class="hide-sm">{{ ' ' + $t('cancel') }}</span>
                    </button>

                    <!-- Confirm move -->
                    <button type="button" class="btn" v-if="shouldDisplayConfirmMove()" :class="null === confirmMove ? 'btn-outline-secondary' : 'btn-success'" :disabled="null === confirmMove" @click="null !== confirmMove && confirmMove()">
                        <BIconCheck />
                        <span class="d-md-none">{{ ' ' + $t('confirm_move.button_label_short') }}</span>
                        <span class="hide-sm">{{ ' ' + $t('confirm_move.button_label') }}</span>
                    </button>

                    <!-- Undo accept -->
                    <button type="button" class="btn btn-success" v-if="shouldDisplayAnswerUndoMove()" @click="answerUndo(true)">
                        <BIconCheck />
                        <span class="hide-sm">{{ $t('undo.accept') }}</span>
                    </button>

                    <!-- Undo reject -->
                    <button type="button" class="btn btn-danger" v-if="shouldDisplayAnswerUndoMove()" @click="answerUndo(false)">
                        <BIconX />
                        <span class="hide-sm">{{ $t('undo.reject') }}</span>
                    </button>

                    <!-- Rematch -->
                    <button type="button" class="btn btn-outline-primary" v-if="canRematch()" @click="createOrAcceptRematch()">
                        <BIconRepeat />
                        <span class="hide-sm">{{ ' ' + $t('rematch.label') }}</span>
                    </button>

                    <!-- Accept / View rematch -->
                    <template v-else-if="hostedGameClient.getRematchGameId() != null">
                        <button v-if="canAcceptRematch" type="button" class="btn btn-success" @click="createOrAcceptRematch()">
                            {{ ' ' + $t('rematch.accept') }}
                        </button>
                        <router-link v-else :to="{ name: 'online-game', params: { gameId: hostedGameClient.getRematchGameId() } }" class="btn btn-outline-primary">
                            {{ ' ' + $t('rematch.view') }}
                        </router-link>
                    </template>

                    <!-- Right button, open sidebar -->
                    <button type="button" class="btn btn-outline-primary open-sidebar-btn" @click="showSidebar()" aria-label="Open game sidebar and chat">
                        <BIconArrowBarLeft />
                        <span v-if="unreadMessages() > 0" class="position-absolute top-0 start-0 translate-middle badge rounded-pill bg-danger">
                            {{ unreadMessages() }}
                            <span class="d-none">{{ ' ' + $t('unread_messages') }}</span>
                        </span>
                    </button>

                    <!-- Secondary actions dropup -->
                    <div class="dropup-center dropup">

                        <!-- Dropup button -->
                        <button type="button" class="btn btn-outline-primary dropdown-toggle" data-bs-toggle="dropdown" aria-label="Secondary actions" aria-expanded="false" data-bs-auto-close="true">
                            <BIconList />
                        </button>

                        <!-- Secondary actions -->
                        <div class="dropdown-menu">

                            <!-- Undo -->
                            <button
                                v-if="shouldDisplayUndoMove()"
                                type="button"
                                class="dropdown-item"
                                :class="!shouldDisableUndoMove() ? 'text-primary' : 'disabled'"
                                :disabled="shouldDisableUndoMove()"
                                @click="askUndo()"
                            >
                                <BIconArrowCounterclockwise />
                                {{ $t('undo.undo_move') }}
                            </button>

                            <!-- Pass -->
                            <button
                                v-if="shouldShowPass()"
                                type="button"
                                class="dropdown-item"
                                :class="shouldEnablePass() ? 'text-warning' : 'text-secondary disabled'"
                                :disabled="!shouldEnablePass()"
                                @click="pass()"
                            >
                                <BIconArrowDownUp />
                                {{ $t('pass') }}
                            </button>

                            <!-- Explore -->
                            <AppHexWorldExplore v-if="gameViewInitialized && gameView" :hostedGameClient :gameView :label="$t('explore')" class="dropdown-item" />
                        </div>
                    </div>

                </div>
            </nav>
        </div>

        <!-- Game sidebar -->
        <div class="sidebar bg-body" v-if="hostedGameClient && gameView">
            <AppGameSidebar
                :hostedGameClient
                :gameView
                @close="showSidebar(false)"
                @toggleCoords="toggleCoords()"
            />
        </div>
    </div>

    <div v-if="null === hostedGameClient || null === gameView" class="container-fluid my-3">
        <p class="lead text-center">{{ $t('loading_game') }}</p>
    </div>

    <AppConnectionAlert />
</template>

<style scoped lang="stylus">
.join-button-container
    top 0
    position absolute
    width 100%
    margin-top 1em

.board-container
    position relative // center "Accept" button relative to this container
    height calc(100vh - 6rem) // (fallback if dvh is not supported)
    height calc(100dvh - 6rem) // 6rem = header and bottom game menu height

.menu-game
    // Mobile UI fix: add margin at bottom if url bar is present,
    // so it is possible to scroll to hide url bar and set full height again,
    // then the UI will fit 100vh again.
    margin-bottom calc(100lvh - 100dvh)

.buttons
    position relative
    display flex
    justify-content center
    gap 0.5em

.game-and-sidebar-container
    position relative
    display flex

    .game
        width 100%

    .sidebar
        display none
        height calc(100vh - 3rem) // (fallback if dvh is not supported)
        height calc(100dvh - 3rem) // 3rem = header height

    .open-sidebar-btn
        position absolute
        right 0
        margin-right 0.75em

sidebarOpen()
    .game
        width 100%

        @media (min-width: 576px)
            width 50%

        @media (min-width: 992px)
            width 55%

        @media (min-width: 1200px)
            width 64%

        @media (min-width: 1400px)
            width 68%

    .sidebar
        display flex
        position relative
        width 100%

        @media (max-width: 575.5px) // .5 is a fix because sometimes 575px only is not inclusive
            position absolute
            right 0
            top 0
            bottom 0
            --bs-bg-opacity 0.85
            // backdrop-filter blur(2px) // laggy on mobile

        @media (min-width: 576px)
            width 50%

        @media (min-width: 992px)
            width 45%

        @media (min-width: 1200px)
            width 36%

        @media (min-width: 1400px)
            width 32%

    .open-sidebar-btn
        display none

.sidebar-open
    sidebarOpen()

.sidebar-auto
    @media (min-width: 576px)
        sidebarOpen()

// Custom hidden when limited space:
// hide on small screen, and medium screen when sidebar is open.
.game-and-sidebar-container
    &.sidebar-closed
        .hide-sm
            display none

            @media (min-width: 576px)
                display unset

    &.sidebar-open, &.sidebar-auto
        .hide-sm
            display none

            @media (min-width: 992px)
                display unset
</style>

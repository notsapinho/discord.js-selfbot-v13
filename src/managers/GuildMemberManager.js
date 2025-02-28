'use strict';

const { Buffer } = require('node:buffer');
const { setTimeout } = require('node:timers');
const { Collection } = require('@discordjs/collection');
require('lodash.permutations');
const _ = require('lodash');
const CachedManager = require('./CachedManager');
const { Error, TypeError, RangeError } = require('../errors');
const BaseGuildVoiceChannel = require('../structures/BaseGuildVoiceChannel');
const { GuildMember } = require('../structures/GuildMember');
const { Role } = require('../structures/Role');
const { Events, Opcodes } = require('../util/Constants');
const { PartialTypes } = require('../util/Constants');
const DataResolver = require('../util/DataResolver');
const GuildMemberFlags = require('../util/GuildMemberFlags');
const SnowflakeUtil = require('../util/SnowflakeUtil');

/**
 * Manages API methods for GuildMembers and stores their cache.
 * @extends {CachedManager}
 */
class GuildMemberManager extends CachedManager {
  constructor(guild, iterable) {
    super(guild.client, GuildMember, iterable);

    /**
     * The guild this manager belongs to
     * @type {Guild}
     */
    this.guild = guild;
  }

  /**
   * The cache of this Manager
   * @type {Collection<Snowflake, GuildMember>}
   * @name GuildMemberManager#cache
   */

  _add(data, cache = true) {
    return super._add(data, cache, { id: data.user.id, extras: [this.guild] });
  }

  /**
   * Data that resolves to give a GuildMember object. This can be:
   * * A GuildMember object
   * * A User resolvable
   * @typedef {GuildMember|UserResolvable} GuildMemberResolvable
   */

  /**
   * Resolves a {@link GuildMemberResolvable} to a {@link GuildMember} object.
   * @param {GuildMemberResolvable} member The user that is part of the guild
   * @returns {?GuildMember}
   */
  resolve(member) {
    const memberResolvable = super.resolve(member);
    if (memberResolvable) return memberResolvable;
    const userResolvable = this.client.users.resolveId(member);
    if (userResolvable) return super.resolve(userResolvable);
    return null;
  }

  /**
   * Resolves a {@link GuildMemberResolvable} to a member id.
   * @param {GuildMemberResolvable} member The user that is part of the guild
   * @returns {?Snowflake}
   */
  resolveId(member) {
    const memberResolvable = super.resolveId(member);
    if (memberResolvable) return memberResolvable;
    const userResolvable = this.client.users.resolveId(member);
    return this.cache.has(userResolvable) ? userResolvable : null;
  }

  /**
   * Options used to add a user to a guild using OAuth2.
   * @typedef {Object} AddGuildMemberOptions
   * @property {string} accessToken An OAuth2 access token for the user with the `guilds.join` scope granted to the
   * bot's application
   * @property {string} [nick] The nickname to give to the member (requires `MANAGE_NICKNAMES`)
   * @property {Collection<Snowflake, Role>|RoleResolvable[]} [roles] The roles to add to the member
   * (requires `MANAGE_ROLES`)
   * @property {boolean} [mute] Whether the member should be muted (requires `MUTE_MEMBERS`)
   * @property {boolean} [deaf] Whether the member should be deafened (requires `DEAFEN_MEMBERS`)
   * @property {boolean} [force] Whether to skip the cache check and call the API directly
   * @property {boolean} [fetchWhenExisting=true] Whether to fetch the user if not cached and already a member
   */

  /**
   * Adds a user to the guild using OAuth2. Requires the `CREATE_INSTANT_INVITE` permission.
   * @param {UserResolvable} user The user to add to the guild
   * @param {AddGuildMemberOptions} options Options for adding the user to the guild
   * @returns {Promise<GuildMember|null>}
   */
  async add(user, options) {
    const userId = this.client.users.resolveId(user);
    if (!userId) throw new TypeError('INVALID_TYPE', 'user', 'UserResolvable');
    if (!options.force) {
      const cachedUser = this.cache.get(userId);
      if (cachedUser) return cachedUser;
    }
    const resolvedOptions = {
      access_token: options.accessToken,
      nick: options.nick,
      mute: options.mute,
      deaf: options.deaf,
    };
    if (options.roles) {
      if (!Array.isArray(options.roles) && !(options.roles instanceof Collection)) {
        throw new TypeError('INVALID_TYPE', 'options.roles', 'Array or Collection of Roles or Snowflakes', true);
      }
      const resolvedRoles = [];
      for (const role of options.roles.values()) {
        const resolvedRole = this.guild.roles.resolveId(role);
        if (!resolvedRole) throw new TypeError('INVALID_ELEMENT', 'Array or Collection', 'options.roles', role);
        resolvedRoles.push(resolvedRole);
      }
      resolvedOptions.roles = resolvedRoles;
    }
    const data = await this.client.api.guilds(this.guild.id).members(userId).put({ data: resolvedOptions });
    // Data is an empty buffer if the member is already part of the guild.
    return data instanceof Buffer ? (options.fetchWhenExisting === false ? null : this.fetch(userId)) : this._add(data);
  }

  /**
   * The client user as a GuildMember of this guild
   * @type {?GuildMember}
   * @readonly
   */
  get me() {
    return (
      this.resolve(this.client.user.id) ??
      (this.client.options.partials.includes(PartialTypes.GUILD_MEMBER)
        ? this._add({ user: { id: this.client.user.id } }, true)
        : null)
    );
  }

  /**
   * Options used to fetch a single member from a guild.
   * @typedef {BaseFetchOptions} FetchMemberOptions
   * @property {UserResolvable} user The user to fetch
   */

  /**
   * Options used to fetch multiple members from a guild.
   * @typedef {Object} FetchMembersOptions
   * @property {UserResolvable|UserResolvable[]} user The user(s) to fetch
   * @property {?string} query Limit fetch to members with similar usernames
   * @property {number} [limit=0] Maximum number of members to request
   * @property {boolean} [withPresences=false] Whether or not to include the presences
   * @property {number} [time=120e3] Timeout for receipt of members
   * @property {?string} nonce Nonce for this request (32 characters max - default to base 16 now timestamp)
   * @property {boolean} [force=false] Whether to skip the cache check and request the API
   */

  /**
   * Fetches member(s) from Discord, even if they're offline.
   * @param {UserResolvable|FetchMemberOptions|FetchMembersOptions} [options] If a UserResolvable, the user to fetch.
   * If undefined, fetches all members.
   * If a query, it limits the results to users with similar usernames.
   * @returns {Promise<GuildMember|Collection<Snowflake, GuildMember>>}
   * @example
   * // Fetch all members from a guild
   * guild.members.fetch()
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch a single member
   * guild.members.fetch('66564597481480192')
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch a single member without checking cache
   * guild.members.fetch({ user, force: true })
   *   .then(console.log)
   *   .catch(console.error)
   * @example
   * // Fetch a single member without caching
   * guild.members.fetch({ user, cache: false })
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch by an array of users including their presences
   * guild.members.fetch({ user: ['66564597481480192', '191615925336670208'], withPresences: true })
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch by query
   * guild.members.fetch({ query: 'hydra', limit: 1 })
   *   .then(console.log)
   *   .catch(console.error);
   * @see {@link https://github.com/aiko-chan-ai/discord.js-selfbot-v13/blob/main/Document/FetchGuildMember.md}
   */
  fetch(options) {
    if (!options || (typeof options === 'object' && !('user' in options) && !('query' in options))) {
      if (
        this.guild.members.me.permissions.has('KICK_MEMBERS') ||
        this.guild.members.me.permissions.has('BAN_MEMBERS') ||
        this.guild.members.me.permissions.has('MANAGE_ROLES')
      ) {
        return this._fetchMany();
      } else if (this.guild.memberCount <= 10000) {
        return this.fetchByMemberSafety();
      } else {
        // NOTE: This is a very slow method, and can take up to 999+ minutes to complete.
        this.fetchBruteforce({
          delay: 50,
          skipWarn: true,
          depth: 1,
        });
      }
    }
    const user = this.client.users.resolveId(options);
    if (user) return this._fetchSingle({ user, cache: true });
    if (options.user) {
      if (Array.isArray(options.user)) {
        options.user = options.user.map(u => this.client.users.resolveId(u));
        return this._fetchMany(options);
      } else {
        options.user = this.client.users.resolveId(options.user);
      }
      if (!options.limit && !options.withPresences) return this._fetchSingle(options);
    }
    return this._fetchMany(options);
  }

  /**
   * Fetches the client user as a GuildMember of the guild.
   * @param {BaseFetchOptions} [options] The options for fetching the member
   * @returns {Promise<GuildMember>}
   */
  fetchMe(options) {
    return this.fetch({ ...options, user: this.client.user.id });
  }

  /**
   * Options used for searching guild members.
   * @typedef {Object} GuildSearchMembersOptions
   * @property {string} query Filter members whose username or nickname start with this query
   * @property {number} [limit=1] Maximum number of members to search
   * @property {boolean} [cache=true] Whether or not to cache the fetched member(s)
   */

  /**
   * Searches for members in the guild based on a query.
   * @param {GuildSearchMembersOptions} options Options for searching members
   * @returns {Promise<Collection<Snowflake, GuildMember>>}
   */
  async search({ query, limit = 1, cache = true } = {}) {
    const data = await this.client.api.guilds(this.guild.id).members.search.get({ query: { query, limit } });
    return data.reduce((col, member) => col.set(member.user.id, this._add(member, cache)), new Collection());
  }

  /**
   * Options used for listing guild members.
   * @typedef {Object} GuildListMembersOptions
   * @property {Snowflake} [after] Limit fetching members to those with an id greater than the supplied id
   * @property {number} [limit=1] Maximum number of members to list
   * @property {boolean} [cache=true] Whether or not to cache the fetched member(s)
   */

  /**
   * Lists up to 1000 members of the guild.
   * @param {GuildListMembersOptions} [options] Options for listing members
   * @returns {Promise<Collection<Snowflake, GuildMember>>}
   */
  async list({ after, limit = 1, cache = true } = {}) {
    const data = await this.client.api.guilds(this.guild.id).members.get({ query: { after, limit } });
    return data.reduce((col, member) => col.set(member.user.id, this._add(member, cache)), new Collection());
  }

  /**
   * The data for editing a guild member.
   * @typedef {Object} GuildMemberEditData
   * @property {?string} [nick] The nickname to set for the member
   * @property {Collection<Snowflake, Role>|RoleResolvable[]} [roles] The roles or role ids to apply
   * @property {boolean} [mute] Whether or not the member should be muted
   * @property {boolean} [deaf] Whether or not the member should be deafened
   * @property {GuildVoiceChannelResolvable|null} [channel] Channel to move the member to
   * (if they are connected to voice), or `null` if you want to disconnect them from voice
   * @property {DateResolvable|null} [communicationDisabledUntil] The date or timestamp
   * for the member's communication to be disabled until. Provide `null` to enable communication again.
   * @property {GuildMemberFlagsResolvable} [flags] The flags to set for the member
   * @property {?(BufferResolvable|Base64Resolvable)} [avatar] The new guild avatar
   * @property {?(BufferResolvable|Base64Resolvable)} [banner] The new guild banner
   * @property {?string} [bio] The new guild about me
   */

  /**
   * Edits a member of the guild.
   * <info>The user must be a member of the guild</info>
   * @param {UserResolvable} user The member to edit
   * @param {GuildMemberEditData} data The data to edit the member with
   * @param {string} [reason] Reason for editing this user
   * @returns {Promise<GuildMember>}
   */
  async edit(user, data, reason) {
    const id = this.client.users.resolveId(user);
    if (!id) throw new TypeError('INVALID_TYPE', 'user', 'UserResolvable');

    // Clone the data object for immutability
    const _data = { ...data };
    if (_data.channel) {
      _data.channel = this.guild.channels.resolve(_data.channel);
      if (!(_data.channel instanceof BaseGuildVoiceChannel)) {
        throw new Error('GUILD_VOICE_CHANNEL_RESOLVE');
      }
      _data.channel_id = _data.channel.id;
      _data.channel = undefined;
    } else if (_data.channel === null) {
      _data.channel_id = null;
      _data.channel = undefined;
    }
    _data.roles &&= _data.roles.map(role => (role instanceof Role ? role.id : role));

    _data.communication_disabled_until =
      _data.communicationDisabledUntil && new Date(_data.communicationDisabledUntil).toISOString();

    _data.flags = _data.flags && GuildMemberFlags.resolve(_data.flags);

    // Avatar, banner, bio
    if (typeof _data.avatar !== 'undefined') {
      _data.avatar = await DataResolver.resolveImage(_data.avatar);
    }
    if (typeof _data.banner !== 'undefined') {
      _data.banner = await DataResolver.resolveImage(_data.banner);
    }

    let endpoint = this.client.api.guilds(this.guild.id);
    if (id === this.client.user.id) {
      const keys = Object.keys(data);
      if (keys.length === 1 && ['nick', 'avatar', 'banner', 'bio'].includes(keys[0])) {
        endpoint = endpoint.members('@me');
      } else {
        endpoint = endpoint.members(id);
      }
    } else {
      endpoint = endpoint.members(id);
    }
    const d = await endpoint.patch({ data: _data, reason });

    const clone = this.cache.get(id)?._clone();
    clone?._patch(d);
    return clone ?? this._add(d, false);
  }

  /**
   * Options used for pruning guild members.
   * <info>It's recommended to set {@link GuildPruneMembersOptions#count options.count}
   * to `false` for large guilds.</info>
   * @typedef {Object} GuildPruneMembersOptions
   * @property {number} [days=7] Number of days of inactivity required to kick
   * @property {boolean} [dry=false] Get the number of users that will be kicked, without actually kicking them
   * @property {boolean} [count=true] Whether or not to return the number of users that have been kicked.
   * @property {RoleResolvable[]} [roles] Array of roles to bypass the "...and no roles" constraint when pruning
   * @property {string} [reason] Reason for this prune
   */

  /**
   * Prunes members from the guild based on how long they have been inactive.
   * @param {GuildPruneMembersOptions} [options] Options for pruning
   * @returns {Promise<number|null>} The number of members that were/will be kicked
   * @example
   * // See how many members will be pruned
   * guild.members.prune({ dry: true })
   *   .then(pruned => console.log(`This will prune ${pruned} people!`))
   *   .catch(console.error);
   * @example
   * // Actually prune the members
   * guild.members.prune({ days: 1, reason: 'too many people!' })
   *   .then(pruned => console.log(`I just pruned ${pruned} people!`))
   *   .catch(console.error);
   * @example
   * // Include members with a specified role
   * guild.members.prune({ days: 7, roles: ['657259391652855808'] })
   *    .then(pruned => console.log(`I just pruned ${pruned} people!`))
   *    .catch(console.error);
   */
  async prune({ days = 7, dry = false, count: compute_prune_count = true, roles = [], reason } = {}) {
    if (typeof days !== 'number') throw new TypeError('PRUNE_DAYS_TYPE');

    const query = { days };
    const resolvedRoles = [];

    for (const role of roles) {
      const resolvedRole = this.guild.roles.resolveId(role);
      if (!resolvedRole) {
        throw new TypeError('INVALID_ELEMENT', 'Array', 'options.roles', role);
      }
      resolvedRoles.push(resolvedRole);
    }

    if (resolvedRoles.length) {
      query.include_roles = dry ? resolvedRoles.join(',') : resolvedRoles;
    }

    const endpoint = this.client.api.guilds(this.guild.id).prune;

    const { pruned } = await (dry
      ? endpoint.get({ query, reason })
      : endpoint.post({ data: { ...query, compute_prune_count }, reason }));

    return pruned;
  }

  /**
   * Kicks a user from the guild.
   * <info>The user must be a member of the guild</info>
   * @param {UserResolvable} user The member to kick
   * @param {string} [reason] Reason for kicking
   * @returns {Promise<GuildMember|User|Snowflake>} Result object will be resolved as specifically as possible.
   * If the GuildMember cannot be resolved, the User will instead be attempted to be resolved. If that also cannot
   * be resolved, the user's id will be the result.
   * @example
   * // Kick a user by id (or with a user/guild member object)
   * guild.members.kick('84484653687267328')
   *   .then(kickInfo => console.log(`Kicked ${kickInfo.user?.tag ?? kickInfo.tag ?? kickInfo}`))
   *   .catch(console.error);
   */
  async kick(user, reason) {
    const id = this.client.users.resolveId(user);
    if (!id) return Promise.reject(new TypeError('INVALID_TYPE', 'user', 'UserResolvable'));

    await this.client.api.guilds(this.guild.id).members(id).delete({ reason });

    return this.resolve(user) ?? this.client.users.resolve(user) ?? id;
  }

  /**
   * Bans a user from the guild.
   * @param {UserResolvable} user The user to ban
   * @param {BanOptions} [options] Options for the ban
   * @returns {Promise<GuildMember|User|Snowflake>} Result object will be resolved as specifically as possible.
   * If the GuildMember cannot be resolved, the User will instead be attempted to be resolved. If that also cannot
   * be resolved, the user id will be the result.
   * Internally calls the GuildBanManager#create method.
   * @example
   * // Ban a user by id (or with a user/guild member object)
   * guild.members.ban('84484653687267328')
   *   .then(banInfo => console.log(`Banned ${banInfo.user?.tag ?? banInfo.tag ?? banInfo}`))
   *   .catch(console.error);
   */
  ban(user, options) {
    return this.guild.bans.create(user, options);
  }

  /**
   * Unbans a user from the guild. Internally calls the {@link GuildBanManager#remove} method.
   * @param {UserResolvable} user The user to unban
   * @param {string} [reason] Reason for unbanning user
   * @returns {Promise<?User>} The user that was unbanned
   * @example
   * // Unban a user by id (or with a user/guild member object)
   * guild.members.unban('84484653687267328')
   *   .then(user => console.log(`Unbanned ${user.username} from ${guild.name}`))
   *   .catch(console.error);
   */
  unban(user, reason) {
    return this.guild.bans.remove(user, reason);
  }

  async _fetchSingle({ user, cache, force = false }) {
    if (!force) {
      const existing = this.cache.get(user);
      if (existing && !existing.partial) return existing;
    }

    const data = await this.client.api.guilds(this.guild.id).members(user).get();
    return this._add(data, cache);
  }

  /**
   * Options used to fetch multiple members from a guild.
   * @typedef {Object} BruteforceOptions
   * @property {number} [limit=100] Maximum number of members per request
   * @property {number} [delay=500] Timeout for new requests in ms
   * @property {number} [depth=1] Permutations length
   */

  /**
   * Fetches multiple members from the guild.
   * @param {BruteforceOptions} options Options for the bruteforce
   * @returns {Collection<Snowflake, GuildMember>} (All) members in the guild
   * @see https://github.com/aiko-chan-ai/discord.js-selfbot-v13/blob/main/Document/FetchGuildMember.md
   * @example
   * guild.members.fetchBruteforce()
   * .then(members => console.log(`Fetched ${members.size} members`))
   * .catch(console.error);
   */
  fetchBruteforce(options = {}) {
    const defaultQuery = 'abcdefghijklmnopqrstuvwxyz0123456789!"#$%&\'()*+,-./:;<=>?@[]^_`{|}~ ';
    let dictionary;
    let limit = 100;
    let delay = 500;
    let depth = 1;
    if (options?.limit) limit = options?.limit;
    if (options?.delay) delay = options?.delay;
    if (options?.depth) depth = options?.depth;
    if (typeof limit !== 'number') throw new TypeError('INVALID_TYPE', 'limit', 'Number');
    if (limit < 1 || limit > 100) throw new RangeError('INVALID_RANGE_QUERY_MEMBER');
    if (typeof delay !== 'number') throw new TypeError('INVALID_TYPE', 'delay', 'Number');
    if (typeof depth !== 'number') throw new TypeError('INVALID_TYPE', 'depth', 'Number');
    if (depth < 1) throw new RangeError('INVALID_RANGE_QUERY_MEMBER');
    if (depth > 2) {
      console.warn(`[WARNING] GuildMemberManager#fetchBruteforce: depth greater than 2, can lead to very slow speeds`);
    }
    if (delay < 500 && !options?.skipWarn) {
      console.warn(
        `[WARNING] GuildMemberManager#fetchBruteforce: delay is less than 500ms, this may cause rate limits.`,
      );
    }
    let skipValues = [];
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      for (let i = 1; i <= depth; i++) {
        dictionary = _(defaultQuery)
          .permutations(i)
          .map(v => _.join(v, ''))
          .value();
        for (const query of dictionary) {
          if (this.guild.members.cache.size >= this.guild.memberCount) break;
          this.client.emit(
            'debug',
            `[INFO] GuildMemberManager#fetchBruteforce: Querying ${query}, Skip: [${skipValues.join(', ')}]`,
          );
          if (skipValues.some(v => query.startsWith(v))) continue;
          await this._fetchMany({ query, limit })
            .then(members => {
              if (members.size === 0) skipValues.push(query);
            })
            .catch(reject);
          await this.guild.client.sleep(delay);
        }
      }
      resolve(this.guild.members.cache);
    });
  }

  /**
   * Experimental method to fetch members from the guild.
   * <info>Lists up to 10000 members of the guild.</info>
   * @param {number} [timeout=15_000] Timeout for receipt of members in ms
   * @returns {Promise<Collection<Snowflake, GuildMember>>}
   */
  fetchByMemberSafety(timeout = 15_000) {
    return new Promise(resolve => {
      const nonce = SnowflakeUtil.generate();
      let timeout_ = setTimeout(() => {
        this.client.removeListener(Events.GUILD_MEMBER_LIST_UPDATE, handler);
        resolve(this.guild.members.cache);
      }, timeout).unref();
      const handler = (members, guild, raw) => {
        if (guild.id == this.guild.id && raw.nonce == nonce) {
          if (members.size > 0) {
            this.client.ws.broadcast({
              op: 35,
              d: {
                guild_id: this.guild.id,
                query: '',
                continuation_token: members.first()?.id,
                nonce,
              },
            });
          } else {
            clearTimeout(timeout_);
            this.client.removeListener(Events.GUILD_MEMBER_LIST_UPDATE, handler);
            resolve(this.guild.members.cache);
          }
        }
      };
      this.client.on('guildMembersChunk', handler);
      this.client.ws.broadcast({
        op: 35,
        d: {
          guild_id: this.guild.id,
          query: '',
          continuation_token: null,
          nonce,
        },
      });
    });
  }

  /**
   * Fetches multiple members from the guild in the channel.
   * @param {GuildTextChannelResolvable} channel The channel to get members from (Members has VIEW_CHANNEL permission)
   * @param {number} [offset=0] Start index of the members to get
   * @param {boolean} [double=false] Whether to use double range
   * @param {number} [retryMax=3] Number of retries
   * @param {number} [time=10e3] Timeout for receipt of members
   * @returns {Collection<Snowflake, GuildMember>} Members in the guild
   * @see {@link https://github.com/aiko-chan-ai/discord.js-selfbot-v13/blob/main/Document/FetchGuildMember.md}
   * @example
   * const guild = client.guilds.cache.get('id');
   * const channel = guild.channels.cache.get('id');
   * // Overlap (slow)
   * for (let index = 0; index <= guild.memberCount; index += 100) {
   *   await guild.members.fetchMemberList(channel, index, index !== 100).catch(() => {});
   *   await client.sleep(500);
   * }
   * // Non-overlap (fast)
   * for (let index = 0; index <= guild.memberCount; index += 200) {
   *   await guild.members.fetchMemberList(channel, index == 0 ? 100 : index, index !== 100).catch(() => {});
   *   await client.sleep(500);
   * }
   * console.log(guild.members.cache.size); // will print the number of members in the guild
   */
  fetchMemberList(channel, offset = 0, double = false, retryMax = 3, time = 10_000) {
    const channel_ = this.guild.channels.resolve(channel);
    if (!channel_?.isText()) throw new TypeError('INVALID_TYPE', 'channel', 'GuildTextChannelResolvable');
    if (typeof offset !== 'number') throw new TypeError('INVALID_TYPE', 'offset', 'Number');
    if (typeof time !== 'number') throw new TypeError('INVALID_TYPE', 'time', 'Number');
    if (typeof retryMax !== 'number') throw new TypeError('INVALID_TYPE', 'retryMax', 'Number');
    if (retryMax < 1) throw new RangeError('INVALID_RANGE_RETRY');
    if (typeof double !== 'boolean') throw new TypeError('INVALID_TYPE', 'double', 'Boolean');
    // TODO: if (this.guild.large) throw new Error('GUILD_IS_LARGE');
    return new Promise((resolve, reject) => {
      const default_ = [[0, 99]];
      const fetchedMembers = new Collection();
      if (offset > 99) {
        // eslint-disable-next-line no-unused-expressions
        double
          ? default_.push([offset, offset + 99], [offset + 100, offset + 199])
          : default_.push([offset, offset + 99]);
      }
      let retry = 0;
      const handler = (members, guild, type, raw) => {
        timeout.refresh();
        if (guild.id !== this.guild.id) return;
        if (type == 'INVALIDATE' && offset > 100) {
          if (retry < retryMax) {
            this.guild.shard.send({
              op: Opcodes.GUILD_SUBSCRIPTIONS,
              d: {
                guild_id: this.guild.id,
                typing: true,
                threads: true,
                activities: true,
                channels: {
                  [channel_.id]: default_,
                },
                thread_member_lists: [],
                members: [],
              },
            });
            retry++;
          } else {
            clearTimeout(timeout);
            this.client.removeListener(Events.GUILD_MEMBER_LIST_UPDATE, handler);
            this.client.decrementMaxListeners();
            reject(new Error('INVALIDATE_MEMBER', raw.ops[0].range));
          }
        } else {
          for (const member of members.values()) {
            fetchedMembers.set(member.id, member);
          }
          clearTimeout(timeout);
          this.client.removeListener(Events.GUILD_MEMBER_LIST_UPDATE, handler);
          this.client.decrementMaxListeners();
          resolve(fetchedMembers);
        }
      };
      const timeout = setTimeout(() => {
        this.client.removeListener(Events.GUILD_MEMBER_LIST_UPDATE, handler);
        this.client.decrementMaxListeners();
        reject(new Error('GUILD_MEMBERS_TIMEOUT'));
      }, time).unref();
      this.client.incrementMaxListeners();
      this.client.on(Events.GUILD_MEMBER_LIST_UPDATE, handler);
      this.guild.shard.send({
        op: Opcodes.GUILD_SUBSCRIPTIONS,
        d: {
          guild_id: this.guild.id,
          typing: true,
          threads: true,
          activities: true,
          channels: {
            [channel_.id]: default_,
          },
          thread_member_lists: [],
          members: [],
        },
      });
    });
  }

  /**
   * Adds a role to a member.
   * @param {GuildMemberResolvable} user The user to add the role from
   * @param {RoleResolvable} role The role to add
   * @param {string} [reason] Reason for adding the role
   * @returns {Promise<GuildMember|User|Snowflake>}
   */
  async addRole(user, role, reason) {
    const userId = this.guild.members.resolveId(user);
    const roleId = this.guild.roles.resolveId(role);

    await this.client.api.guilds(this.guild.id).members(userId).roles(roleId).put({ reason });

    return this.resolve(user) ?? this.client.users.resolve(user) ?? userId;
  }

  /**
   * Removes a role from a member.
   * @param {UserResolvable} user The user to remove the role from
   * @param {RoleResolvable} role The role to remove
   * @param {string} [reason] Reason for removing the role
   * @returns {Promise<GuildMember|User|Snowflake>}
   */
  async removeRole(user, role, reason) {
    const userId = this.guild.members.resolveId(user);
    const roleId = this.guild.roles.resolveId(role);

    await this.client.api.guilds(this.guild.id).members(userId).roles(roleId).delete({ reason });

    return this.resolve(user) ?? this.client.users.resolve(user) ?? userId;
  }

  _fetchMany({
    limit = 0,
    withPresences: presences = true,
    user: user_ids,
    query,
    time = 120e3,
    nonce = SnowflakeUtil.generate(),
  } = {}) {
    return new Promise((resolve, reject) => {
      if (!query && !user_ids) query = '';
      if (nonce.length > 32) throw new RangeError('MEMBER_FETCH_NONCE_LENGTH');
      this.guild.shard.send({
        op: Opcodes.REQUEST_GUILD_MEMBERS,
        d: {
          guild_id: this.guild.id,
          presences,
          user_ids,
          query,
          nonce,
          limit,
        },
      });
      const fetchedMembers = new Collection();
      let i = 0;
      const handler = (members, _, chunk) => {
        timeout.refresh();
        if (chunk.nonce !== nonce) return;
        i++;
        for (const member of members.values()) {
          fetchedMembers.set(member.id, member);
        }
        if (members.size < 1_000 || (limit && fetchedMembers.size >= limit) || i === chunk.count) {
          clearTimeout(timeout);
          this.client.removeListener(Events.GUILD_MEMBERS_CHUNK, handler);
          this.client.decrementMaxListeners();
          let fetched = fetchedMembers;
          if (user_ids && !Array.isArray(user_ids) && fetched.size) fetched = fetched.first();
          resolve(fetched);
        }
      };
      const timeout = setTimeout(() => {
        this.client.removeListener(Events.GUILD_MEMBERS_CHUNK, handler);
        this.client.decrementMaxListeners();
        reject(new Error('GUILD_MEMBERS_TIMEOUT'));
      }, time).unref();
      this.client.incrementMaxListeners();
      this.client.on(Events.GUILD_MEMBERS_CHUNK, handler);
    });
  }
}

module.exports = GuildMemberManager;

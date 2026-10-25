// The in-game script, with this site's URL and the game's feed token filled in.
// It pulls gifts and timers over HttpService, so no DataStore or extra Roblox permission is needed.
export const gameScript = (site, universeId, token) => `--!strict
-- Update Day bridge for this game. Put it in a Script in ServerScriptService and turn on
-- Game Settings > Security > Allow HTTP Requests. Keep this script on the server: it holds a secret.
--
-- Gifts:  connect to ServerStorage.UpdateDayGift and give the reward yourself:
--           game.ServerStorage:WaitForChild("UpdateDayGift").Event:Connect(function(player, gift)
--             -- gift.type, gift.item, gift.tier, gift.amount
--           end)
-- Timers: ReplicatedStorage.UpdateDayTimers has one IntValue per timer. Value is the end time
--         in Unix seconds, so value - os.time() is the time left.
-- Player data: when the website asks, one server finds your DataStores and the player's keys
--         by itself (nothing to configure), reads them, and saves edits.

local SITE = "${site}"
local UNIVERSE = "${universeId}"
local TOKEN = "${token}"

local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")
local MemoryStoreService = game:GetService("MemoryStoreService")
local MessagingService = game:GetService("MessagingService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local giftEvent = Instance.new("BindableEvent")
giftEvent.Name = "UpdateDayGift"
giftEvent.Parent = ServerStorage

local timers = Instance.new("Folder")
timers.Name = "UpdateDayTimers"
timers.Parent = ReplicatedStorage

local function call(method: string, path: string, body: any?): any?
	local ok, res = pcall(HttpService.RequestAsync, HttpService, {
		Url = SITE .. "/api/" .. path,
		Method = method,
		Headers = { ["Content-Type"] = "application/json", ["X-Feed-Token"] = TOKEN },
		Body = body and HttpService:JSONEncode(body) or nil,
	})
	if not ok or not res.Success then
		warn("[UpdateDay]", path, ok and res.StatusCode or res)
		return nil
	end
	return HttpService:JSONDecode(res.Body)
end

local function claim(player: Player)
	local gifts = call("POST", "feed/claim", { u = UNIVERSE, userId = tostring(player.UserId) })
	for _, gift in ipairs(gifts or {}) do
		giftEvent:Fire(player, gift)
	end
end

local function syncTimers()
	local feed = call("GET", "feed?u=" .. UNIVERSE)
	if not feed then
		return
	end
	timers:ClearAllChildren()
	for name, endsAt in pairs(feed.timers or {}) do
		local v = Instance.new("IntValue")
		v.Name = name
		v.Value = endsAt
		v.Parent = timers
	end
end

-- Every server hears a job; the first to claim it here does it, so the website gets one answer.
local SERVER_ID = game.JobId ~= "" and game.JobId or HttpService:GenerateGUID(false)
local claims = MemoryStoreService:GetHashMap("UpdateDayJobs")

local function claimJob(id: string): boolean
	local ok, winner = pcall(function()
		return claims:UpdateAsync(id, function(old)
			if old then
				return nil -- someone else has it
			end
			return SERVER_ID
		end, 300)
	end)
	return ok and winner == SERVER_ID
end

local function listStores(): { string }
	local names = {}
	local ok, pages = pcall(DataStoreService.ListDataStoresAsync, DataStoreService)
	while ok and #names < 40 do
		for _, info in ipairs(pages:GetCurrentPage()) do
			table.insert(names, info.DataStoreName)
		end
		if pages.IsFinished then
			break
		end
		ok = pcall(pages.AdvanceToNextPageAsync, pages)
	end
	return names
end

-- Learns how a store names its keys from a few real ones: "Player_123456" -> "Player_{userId}".
local function guessTemplate(store: DataStore): string?
	local ok, pages = pcall(store.ListKeysAsync, store, "", 25)
	if not ok then
		return nil
	end
	for _, k in ipairs(pages:GetCurrentPage()) do
		local s, e = string.find(k.KeyName, "%d%d%d%d+")
		if s then
			return string.sub(k.KeyName, 1, s - 1) .. "{userId}" .. string.sub(k.KeyName, e + 1)
		end
	end
	return nil
end

local function jsonSafe(value: any): any
	local ok = pcall(HttpService.JSONEncode, HttpService, { v = value })
	return if ok then value else tostring(value)
end

local function readPlayer(job): { any }
	local results = {}
	for _, name in ipairs(listStores()) do
		if job.known[name] == false then
			continue -- learned earlier: this store isn't keyed by player
		end
		local store = DataStoreService:GetDataStore(name)
		local template = job.known[name] or guessTemplate(store)
		if template then
			local key = string.gsub(template, "{userId}", job.userId)
			local ok, value = pcall(store.GetAsync, store, key)
			table.insert(results, {
				store = name,
				template = template,
				key = key,
				found = ok and value ~= nil,
				value = if ok then jsonSafe(value) else nil,
				error = if ok then nil else tostring(value),
			})
		else
			table.insert(results, { store = name, found = false })
		end
	end
	return results
end

local function writePlayer(job): { ok: boolean, error: string? }
	local store = DataStoreService:GetDataStore(job.store)
	local ok, err = pcall(store.UpdateAsync, store, job.key, function()
		return job.value
	end)
	return { ok = ok, error = if ok then nil else tostring(err) }
end

local function runJob(id: string)
	task.wait(math.random() * 1.5) -- spread the claims out a little
	if not claimJob(id) then
		return
	end
	local job = call("GET", "feed/job?u=" .. UNIVERSE .. "&id=" .. id)
	if not job then
		return
	end
	local result: any = if job.kind == "read" then readPlayer(job) else writePlayer(job)
	call("POST", "feed/job/result", { u = UNIVERSE, id = id, result = result })
end

Players.PlayerAdded:Connect(claim)
for _, p in ipairs(Players:GetPlayers()) do
	task.spawn(claim, p)
end
task.spawn(syncTimers)

-- The website pings running servers so gifts and timers arrive right away.
pcall(function()
	MessagingService:SubscribeAsync("UpdateDay", function(msg)
		local ok, data = pcall(HttpService.JSONDecode, HttpService, msg.Data)
		if not ok then
			return
		end
		if data.type == "timers" then
			syncTimers()
		elseif data.type == "job" then
			task.spawn(runJob, tostring(data.id))
		elseif data.type == "gift" then
			local player = Players:GetPlayerByUserId(tonumber(data.userId) or 0)
			if player then
				claim(player)
			end
		end
	end)
end)

-- Backup in case a message is missed.
while task.wait(300) do
	syncTimers()
end
`;

import React, {
  FC,
  createContext,
  useContext,
  useState,
  useEffect
} from 'react'
import { BigNumber } from 'ethers'
import { formatUnits } from 'ethers/lib/utils'
import Network from 'src/models/Network'
import Token from 'src/models/Token'
import { useApp } from 'src/contexts/AppContext'
import logger from 'src/logger'
import * as config from 'src/config'

type StatsContextProps = {
  stats: any[]
  fetching: boolean,

  bonderStats: any[],
  fetchingBonderStats: boolean,

  pendingAmounts: any[],
  fetchingPendingAmounts: boolean,

  balances: any[],
  fetchingBalances: boolean,

  debitWindowStats: any[],
  fetchingDebitWindowStats: boolean
}

const StatsContext = createContext<StatsContextProps>({
  stats: [],
  fetching: false,

  bonderStats: [],
  fetchingBonderStats: false,

  pendingAmounts: [],
  fetchingPendingAmounts: false,

  balances: [],
  fetchingBalances: false,

  debitWindowStats: [],
  fetchingDebitWindowStats: false
})

type BonderStats = {
  id: string
  bonder: string,
  token: Token,
  network: Network,
  credit: number,
  debit: number,
  availableLiquidity: number
  pendingAmount: number
  virtualDebt: number
  totalAmount: number
  availableEth: number
}

type DebitWindowStats = {
  token: Token
  amountBonded: number[]
  remainingMin: number
}

const StatsContextProvider: FC = ({ children }) => {
  const { networks, tokens, sdk } = useApp()
  const [stats, setStats] = useState<any[]>([])
  const [fetching, setFetching] = useState<boolean>(false)
  const [bonderStats, setBonderStats] = useState<any[]>([])
  const [fetchingBonderStats, setFetchingBonderStats] = useState<boolean>(false)
  const [pendingAmounts, setPendingAmounts] = useState<any[]>([])
  const [fetchingPendingAmounts, setFetchingPendingAmounts] = useState<boolean>(false)
  const [balances, setBalances] = useState<any[]>([])
  const [fetchingBalances, setFetchingBalances] = useState<boolean>(false)
  const [debitWindowStats, setDebitWindowStats] = useState<any[]>([])
  const [fetchingDebitWindowStats, setFetchingDebitWindowStats] = useState<boolean>(false)
  const filteredNetworks = networks?.filter(token => !token.isLayer1)

  async function fetchStats (selectedNetwork: Network, selectedToken: Token) {
    if (!selectedNetwork) {
      return
    }
    const token = tokens.find(token => token.symbol === selectedToken?.symbol)
    if (!token) {
      return
    }

    const hopToken = new Token({
      symbol: `h${token?.symbol}`,
      tokenName: token?.tokenName,
      imageUrl: token?.imageUrl,
      decimals: token?.decimals,
    })
    const decimals = hopToken.decimals
    const token0 = {
      symbol: selectedToken?.networkSymbol(selectedNetwork)
    }
    const token1 = {
      symbol: hopToken.networkSymbol(selectedNetwork)
    }

    const bridge = sdk.bridge(selectedToken.symbol)
    if (!bridge.isSupportedAsset(selectedNetwork.slug)) {
      return
    }
    const reserves = await bridge.getSaddleSwapReserves(selectedNetwork.slug)
    const reserve0 = Number(formatUnits(reserves[0].toString(), decimals))
    const reserve1 = Number(formatUnits(reserves[1].toString(), decimals))

    return {
      id: `${selectedNetwork.slug}-${token0.symbol}-${token1.symbol}`,
      pairAddress: null,
      pairUrl: '#',
      totalLiquidity: reserve0 + reserve1,
      token0,
      token1,
      reserve0,
      reserve1,
      network: selectedNetwork
    }
  }

  useEffect(() => {
    const update = async () => {
      if (!filteredNetworks) {
        return
      }
      setFetching(true)
      const promises: Promise<any>[] = []
      for (const network of filteredNetworks) {
        for (const token of tokens) {
          promises.push(fetchStats(network, token).catch(logger.error))
        }
      }
      const results: any[] = await Promise.all(promises)
      setFetching(false)
      setStats(results.filter(x => x))
    }

    update().catch(logger.error)
  }, [])

  async function fetchBonderStats (selectedNetwork: Network, selectedToken: Token, bonder: string): Promise<BonderStats | undefined> {
    if (!selectedNetwork) {
      return
    }
    if (!pendingAmounts?.length) {
      return
    }
    const token = tokens.find(token => token.symbol === selectedToken?.symbol)
    if (!token) {
      return
    }

    const bridge = sdk.bridge(selectedToken.symbol)
    if (!bridge.isSupportedAsset(selectedNetwork.slug)) {
      return
    }
    const [credit, debit, totalDebit, availableLiquidity, eth] = await Promise.all([
      bridge.getCredit(selectedNetwork.slug, bonder),
      bridge.getDebit(selectedNetwork.slug, bonder),
      bridge.getTotalDebit(selectedNetwork.slug, bonder),
      bridge.getAvailableLiquidity(selectedNetwork.slug, selectedNetwork.slug, bonder),
      bridge.getEthBalance(selectedNetwork.slug, bonder)
    ])

    const virtualDebt = totalDebit.sub(debit)
    let pendingAmount = BigNumber.from(0)
    for (const obj of pendingAmounts) {
      if (obj.destinationNetwork.slug === selectedNetwork.slug && obj.token.symbol === token.symbol) {
        pendingAmount = pendingAmount.add(obj.pendingAmount)
      }
    }

    return {
      id: `${selectedNetwork.slug}-${token.symbol}-${bonder}`,
      bonder,
      token,
      network: selectedNetwork,
      credit: Number(formatUnits(credit.toString(), token.decimals)),
      debit: Number(formatUnits(totalDebit.toString(), token.decimals)),
      availableLiquidity: Number(formatUnits(availableLiquidity.toString(), token.decimals)),
      pendingAmount: Number(formatUnits(pendingAmount.toString(), token.decimals)),
      virtualDebt: Number(formatUnits(virtualDebt.toString(), token.decimals)),
      totalAmount: Number(formatUnits(availableLiquidity.add(pendingAmount).add(virtualDebt), token.decimals)),
      availableEth: Number(formatUnits(eth.toString(), 18))
    }
  }

  useEffect(() => {
    const update = async () => {
      if (!networks) {
        return
      }
      setFetchingBonderStats(true)
      const promises: Promise<any>[] = []
      for (const network of networks) {
        for (const token of tokens) {
          for (const bonder of config.addresses.bonders?.[token.symbol]) {
            promises.push(fetchBonderStats(network, token, bonder).catch(logger.error))
          }
        }
      }
      const results: any[] = await Promise.all(promises)
      setFetchingBonderStats(false)
      setBonderStats(results.filter(x => x))
    }

    update().catch(logger.error)
  }, [pendingAmounts])

  async function fetchPendingAmounts (sourceNetwork: Network, destinationNetwork: Network, token: Token) {
    if (!sourceNetwork) {
      return
    }
    if (!destinationNetwork) {
      return
    }
    if (!token) {
      return
    }

    const bridge = sdk.bridge(token.symbol)
    if (!bridge.isSupportedAsset(sourceNetwork.slug)) {
      return
    }
    const contract = await bridge.getBridgeContract(sourceNetwork.slug)
    const pendingAmount = await contract.pendingAmountForChainId(destinationNetwork.networkId)
    const formattedPendingAmount = Number(formatUnits(pendingAmount, token.decimals))

    return {
      id: `${sourceNetwork.slug}-${destinationNetwork.slug}-${token.symbol}`,
      sourceNetwork,
      destinationNetwork,
      token,
      pendingAmount,
      formattedPendingAmount,
    }
  }

  useEffect(() => {
    const update = async () => {
      if (!filteredNetworks) {
        return
      }
      setFetchingPendingAmounts(true)
      const promises: Promise<any>[] = []
      for (const sourceNetwork of filteredNetworks) {
        for (const token of tokens) {
          for (const destinationNetwork of networks) {
            if (destinationNetwork === sourceNetwork) {
              continue
            }
            promises.push(fetchPendingAmounts(sourceNetwork, destinationNetwork, token).catch(logger.error))
          }
        }
      }
      const results: any[] = await Promise.all(promises)
      setFetchingPendingAmounts(false)
      setPendingAmounts(results.filter(x => x))
    }

    update().catch(logger.error)
  }, [])

  async function fetchDebitWindowStats (selectedToken: Token, bonder: string): Promise<DebitWindowStats | undefined> {
    if (!pendingAmounts?.length) {
      return
    }
    const token = tokens.find(token => token.symbol === selectedToken?.symbol)
    if (!token) {
      return
    }

    const bridge = sdk.bridge(selectedToken.symbol)
    const slug: string = 'ethereum'

    const currentTime: number = Math.floor(Date.now() / 1000)
    const currentTimeSlot: BigNumber = await bridge.getTimeSlot(slug, currentTime)
    const challengePeriod: BigNumber = await bridge.challengePeriod(slug)
    const timeSlotSize: BigNumber = await bridge.timeSlotSize(slug)
    const numTimeSlots: BigNumber = challengePeriod.div(timeSlotSize)
    const amountBonded: number[] = []

    for (let i = 0; i < Number(numTimeSlots); i++) {
      const timeSlot: number = Number(currentTimeSlot.sub(i))
      const amount: BigNumber = await bridge.timeSlotToAmountBonded(slug, timeSlot, bonder)
      amountBonded.push(Number(formatUnits(amount.toString(), token.decimals)))
    }

    const timeElapsedInSlot: number = currentTime % Number(timeSlotSize)
    const remainingSec: number = Number(timeSlotSize.sub(timeElapsedInSlot))
    const remainingMin: number = Math.ceil(remainingSec / 60)

    return {
      token,
      amountBonded,
      remainingMin
    }
  }

  useEffect(() => {
    const update = async () => {
      if (!networks) {
        return
      }
      setFetchingDebitWindowStats(true)
      const promises: Promise<any>[] = []
      for (const token of tokens) {
        for (const bonder of config.addresses.bonders?.[token.symbol]) {
          promises.push(fetchDebitWindowStats(token, bonder).catch(logger.error))
        }
      }
      const results: any[] = await Promise.all(promises)
      setFetchingDebitWindowStats(false)
      setDebitWindowStats(results.filter(x => x))
    }

    update().catch(logger.error)
  }, [pendingAmounts])

  return (
    <StatsContext.Provider
      value={{
        stats,
        fetching,

        bonderStats,
        fetchingBonderStats,

        pendingAmounts,
        fetchingPendingAmounts,

        balances,
        fetchingBalances,

        debitWindowStats,
        fetchingDebitWindowStats,
      }}
    >
      {children}
    </StatsContext.Provider>
  )
}

export const useStats = () => useContext(StatsContext)

export default StatsContextProvider

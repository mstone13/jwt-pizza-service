const os = require('os');
const config = require('./config.js');

const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;

class MetricBuilder {
  constructor() {
    this._metrics = [];
  }

  // type: 'sum' for counters that only go up, 'gauge' for values that go up and down
  append(metricPrefix, metricName, metricValue, type = 'sum') {
    const value = Number(metricValue);
    if (!Number.isFinite(value)) return this;

    const dataPoint = {
      asDouble: value,
      timeUnixNano: String(Date.now() * 1_000_000),
      attributes: [{ key: 'source', value: { stringValue: config.metrics.source } }],
    };

    const metric = { name: `${metricPrefix}_${metricName}` };
    if (type === 'gauge') {
      metric.gauge = { dataPoints: [dataPoint] };
    } else {
      metric.sum = {
        dataPoints: [dataPoint],
        aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
        isMonotonic: true,
      };
    }
    this._metrics.push(metric);
    return this;
  }

  toString() {
    return JSON.stringify({
      resourceMetrics: [{ scopeMetrics: [{ metrics: this._metrics }] }],
    });
  }
}

class Metrics {
  constructor() {
    this.requestLatency = 0;
    this.requests = {};
    this.purchase = { count: 0, revenue: 0, error: 0, latency: 0};
    this.authEvents = { success: 0, failure: 0 };
    this.activeUsers = new Map();
    this._timer = null;
  }


sendMetricsPeriodically(period) {
    if (this._timer) clearInterval(this._timer); // avoid duplicate timers if called twice
 
    this._timer = setInterval(() => {
      try {
        this.sendMetricsToGrafana(this.getMetrics());
      } catch (error) {
        console.error('Error sending metrics:', error);
      }
    }, period);
 
    this._timer.unref();
  }

metricsReporter = (req, res) => {
  try {
      res.type('text/plain').send(this.getMetrics());
    } catch (error) {
      console.error('Error building metrics:', error);
      res.status(500).send('Error building metrics');
    }
  };

getMetrics(delim = '\n') {
    const buf = new MetricBuilder();
    this.httpMetrics(buf);
    this.systemMetrics(buf);
    this.userMetrics(buf);
    this.purchaseMetrics(buf);
    this.authMetrics(buf);

    return buf.toString(delim);
  }

  sendMetricsToGrafana(metrics) {
  if (!metrics) return;

  const { endpointUrl, accountId, apiKey } = config.metrics ?? {};
  if (!endpointUrl || !accountId || !apiKey) {
    if (!this._warnedConfig) {
      console.warn('Grafana metrics endpoint or credentials not configured. Metrics will not be sent.');
      this._warnedConfig = true;
    }
    return;
  }

  fetch(endpointUrl, {
    method: 'POST',
    body: metrics,
    headers: {
      Authorization: `Bearer ${accountId}:${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
    .then(async (res) => {
      // fetch does not reject on 4xx/5xx, so check explicitly
      if (!res.ok) {
        console.error('Grafana push failed:', res.status, await res.text());
      } else {
        console.log('Pushed OK', res.status); // temporary: remove once you've confirmed it works
      }
    })
    .catch((error) => {
      console.error('Error sending metrics to Grafana:', error);
    });
  }

 requestTracker = (req, res, next) => {
    const httpMethod = req.method.toLowerCase();
    this.requests[httpMethod] = (this.requests[httpMethod] ?? 0) + 1;
 
    const start = Date.now();
 
    if (req.user?.id !== undefined) {
      this.addActiveUser(req.user.id);
    }
 
    // 'finish' fires for every response type (send, json, end, sendFile, redirect...)
    res.on('finish', () => {
      this.requestLatency += Date.now() - start;
    });
 
    next();
  };

addActiveUser(userId) {
  this.activeUsers.set(userId, Date.now());
}

removeActiveUser(userId) {
  this.activeUsers.delete(userId);
} 

authAttempt(success) {
  if (success) {
    this.authEvents.success += 1;
  } else {
    this.authEvents.failure += 1;
  }
}

loginEvent = (userId, success) => {
  this.authAttempt(success);
  if (success) this.addActiveUser(userId);
};

  // order event: count, revenue, error, start, end
orderEvent = (orderEvent) => {
  this.purchase.count += orderEvent.count;
  this.purchase.revenue += orderEvent.revenue;
  this.purchase.error += orderEvent.error ? 1 : 0;
  if (orderEvent.end && orderEvent.start) {
    const latency = orderEvent.end - orderEvent.start;
    this.purchase.latency += latency;
  }
}

// other metrics functions...

httpMetrics(buf) {
  buf.append('pizza_http_latency', 'total', this.requestLatency);
  const totalRequests = Object.values(this.requests).reduce((acc, curr) => acc + curr, 0);
  buf.append('pizza_http_requests', 'all_total', totalRequests);
  Object.keys(this.requests).forEach((httpMethod) => {
    buf.append('pizza_http_requests', `${httpMethod}_total`, this.requests[httpMethod]);
  });
}

systemMetrics(buf) {
  buf.append('pizza_system', 'cpu_usage_percent', this.getCpuUsagePercentage(), 'gauge');
  buf.append('pizza_system', 'memory_usage_percent', this.getMemoryUsagePercentage(), 'gauge');
}

userMetrics(buf) {
  buf.append('pizza_active_users', 'count', this.getActiveUsersCount(), 'gauge');
}

purchaseMetrics(buf) {
  buf.append('pizza_purchase', 'count', this.purchase.count);
  buf.append('pizza_purchase', 'revenue', this.purchase.revenue);
  buf.append('pizza_purchase', 'error_count', this.purchase.error);
  buf.append('pizza_purchase', 'latency_total', this.purchase.latency);
}

authMetrics(buf) {
  buf.append('pizza_auth', 'success_count', this.authEvents.success);
  buf.append('pizza_auth', 'failure_count', this.authEvents.failure);
}

getActiveUsersCount() {
  const cutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
  for (const [userId, lastActive] of this.activeUsers.entries()) {
    if (lastActive < cutoff) {
      this.activeUsers.delete(userId);
    }
  }
  return this.activeUsers.size;
}


getCpuUsagePercentage() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  }

  const prev = this._lastCpu;
  this._lastCpu = { idle, total };
  if (!prev) return 0; // first call has nothing to compare against

  const idleDiff = idle - prev.idle;
  const totalDiff = total - prev.total;
  if (totalDiff <= 0) return 0;

  return Number(((1 - idleDiff / totalDiff) * 100).toFixed(2));
}

getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  return Number(((usedMemory / totalMemory) * 100).toFixed(2));
}

}

module.exports = new Metrics();

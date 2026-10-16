"""All association marginals refer to the SAME relation-edge population."""
import math


def association(count: int, left: int, right: int, total: int):
    if not (0 <= count <= min(left, right) and left + right - count <= total):
        raise ValueError("Inconsistent contingency table")
    expected = left * right / total if total else 0.0
    table = [count, left-count, right-count, total-left-right+count]
    expected_cells = [expected, left-expected, right-expected, total-left-right+expected]
    g2 = 2 * sum(o * math.log(o/e) for o,e in zip(table, expected_cells) if o and e)
    dice = 2 * count / (left + right) if left + right else 0.0
    return dict(raw_count=count, expected_independence=expected,
                pmi=math.log2(count/expected) if count and expected else None,
                mi3=math.log2(count**3/expected) if count and expected else None,
                t_score=(count-expected)/math.sqrt(count) if count else None,
                log_dice=14+math.log2(dice) if dice else None,
                log_likelihood=g2, log_likelihood_direction="attraction" if count > expected else "avoidance",
                dice=dice, marginals=dict(lemma=left, collocate=right, relation_edges=total))


def wilson(count, total, z=1.96):
    if not total:
        return [0.0, 1.0]
    p = count/total
    center = (p+z*z/(2*total))/(1+z*z/total)
    half = z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))/(1+z*z/total)
    return [max(0.0, center-half), min(1.0, center+half)]


def binomial_cdf(k, n, p):
    """Stable lower-tail probability without requiring SciPy."""
    if k >= n or p <= 0:
        return 1.0
    if p >= 1:
        return float(k >= n)
    terms = [math.lgamma(n+1)-math.lgamma(i+1)-math.lgamma(n-i+1)
             + i*math.log(p)+(n-i)*math.log1p(-p) for i in range(k+1)]
    top = max(terms)
    return min(1.0, math.exp(top)*sum(math.exp(t-top) for t in terms))


def absence(observed, object_total, base_rate, stratified_expected):
    expected = object_total * base_rate
    return dict(expected_count=expected, observed_count=observed,
                log_absence=math.log1p(expected)-math.log1p(observed),
                stratified_expected_count=stratified_expected,
                stratified_log_absence=math.log1p(stratified_expected)-math.log1p(observed),
                raw_binomial_p=binomial_cdf(observed, object_total, base_rate),
                assumptions="independence within the declared synonym set; semantic interchangeability unverified")


def geometric_score(components, weights):
    active = [(components[k], w) for k,w in weights.items() if components.get(k) is not None and w > 0]
    if not active:
        return None
    return 100 * math.exp(sum(w*math.log(max(0.001,v)) for v,w in active)/sum(w for _,w in active))
